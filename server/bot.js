// Optional Discord bot front-end for criss. Plays the SAME game as the Activity
// (shared via gameStore, keyed by channel id), rendered in chat. Only starts if
// DISCORD_BOT_TOKEN is set; discord.js is imported lazily so Activity-only
// deployments don't even need it installed.
import { getGame, emitChange, onChange } from "./gameStore.js";
import { LAYOUTS } from "./crossword/layouts.js";
import { renderGrid, renderClues, renderProgress, renderScores } from "./render.js";
import { renderGridPNG, renderCluesPNG } from "./renderImage.js";

const trunc = (s, n = 1024) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Parse a clue reference like "5A", "5 across", "12d", "3-down".
function parseClue(s) {
  const m = String(s || "").trim().match(/^(\d+)\s*[-\s]?\s*(a|across|d|down)$/i);
  if (!m) return null;
  return { number: parseInt(m[1], 10), direction: m[2][0].toLowerCase() === "a" ? "across" : "down" };
}

export async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("[bot] DISCORD_BOT_TOKEN not set — Discord bot disabled (Activity still works).");
    return null;
  }

  const {
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
  } = await import("discord.js");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  // ---------- slash command definitions ----------
  const directionOpt = (o) =>
    o.setName("direction").setDescription("across or down").setRequired(true)
      .addChoices({ name: "Across", value: "across" }, { name: "Down", value: "down" });
  const commands = [
    new SlashCommandBuilder()
      .setName("crossword").setDescription("Start a new crossword in this channel")
      .addStringOption((o) => o.setName("layout").setDescription("Grid layout").addChoices(
        ...LAYOUTS.slice(0, 25).map((l) => ({ name: l.name, value: l.name })),
      ))
      .addStringOption((o) => o.setName("difficulty").setDescription("Word difficulty (best-effort)").addChoices(
        { name: "Easy", value: "EASY" }, { name: "Moderate", value: "MODERATE" }, { name: "Hard", value: "DIFFICULT" },
      )),
    new SlashCommandBuilder().setName("answer").setDescription("Answer a clue")
      .addIntegerOption((o) => o.setName("number").setDescription("Clue number").setRequired(true))
      .addStringOption(directionOpt)
      .addStringOption((o) => o.setName("word").setDescription("Your answer").setRequired(true)),
    new SlashCommandBuilder().setName("reveal").setDescription("Reveal a clue's answer (no points)")
      .addIntegerOption((o) => o.setName("number").setDescription("Clue number").setRequired(true))
      .addStringOption(directionOpt),
    new SlashCommandBuilder().setName("board").setDescription("Show the current crossword"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Show the scores"),
  ].map((c) => c.toJSON());

  // ---------- board rendering + interactive components ----------
  // Board buttons + clue picker (layout change lives behind the New button).
  const buildComponents = (game) => {
    const rows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("answer").setLabel("Answer").setEmoji("✏️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("new").setLabel("New puzzle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
      ),
    ];
    if (game.hasPuzzle()) {
      const unsolved = game.puzzleFull.entries.filter((e) => !game.solved.has(`${e.direction}-${e.number}`));
      if (unsolved.length && unsolved.length <= 25) {
        rows.push(new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("cluepick").setPlaceholder("Pick a clue to answer…")
            .addOptions(unsolved.slice(0, 25).map((e) => ({
              label: `${e.number}${e.direction === "across" ? "A" : "D"} · ${e.clue}`.slice(0, 100),
              value: `${e.number}:${e.direction}`,
            }))),
        ));
      }
    }
    return rows;
  };

  const boardPayload = async (game) => {
    const p = game.puzzleFull;
    if (!p) {
      return { content: "No puzzle yet — press **🔀 New puzzle** or use `/crossword`.", embeds: [], files: [], components: buildComponents(game) };
    }
    const sub = p.requestedLayout && p.requestedLayout !== p.layoutName ? ` (couldn't fill ${p.requestedLayout})` : "";
    const components = buildComponents(game);
    const gridPng = await renderGridPNG(game).catch(() => null);
    if (gridPng) {
      const e1 = new EmbedBuilder()
        .setTitle(`🧩 ${p.layoutName}${sub}`)
        .setColor(game.isComplete() ? 0x2ecc71 : 0x5865f2)
        .setDescription(renderProgress(game))
        .setImage("attachment://grid.png")
        .addFields({ name: "Scores", value: trunc(renderScores(game)) })
        .setFooter({ text: game.isComplete() ? "Solved! 🎉" : "✏️ Answer · pick a clue below · 🔀 New puzzle" });
      const embeds = [e1];
      const files = [{ attachment: gridPng, name: "grid.png" }];
      const cluesPng = await renderCluesPNG(game).catch(() => null);
      if (cluesPng) {
        embeds.push(new EmbedBuilder().setColor(0x5865f2).setImage("attachment://clues.png"));
        files.push({ attachment: cluesPng, name: "clues.png" });
      }
      return { content: "", embeds, files, components };
    }
    // Fallback: ASCII grid + text clue lists if image rendering isn't available.
    const embed = new EmbedBuilder()
      .setTitle(`🧩 ${p.layoutName}${sub}`)
      .setColor(game.isComplete() ? 0x2ecc71 : 0x5865f2)
      .setDescription("```\n" + renderGrid(game) + "\n```\n" + renderProgress(game))
      .addFields(
        { name: "Across", value: trunc(renderClues(game, "across")), inline: true },
        { name: "Down", value: trunc(renderClues(game, "down")), inline: true },
        { name: "Scores", value: trunc(renderScores(game)) },
      );
    return { content: "", embeds: [embed], files: [], components };
  };

  // ---------- live board message per channel ----------
  const boards = new Map();
  const editTimers = new Map();
  const scheduleEdit = (roomId) => {
    const msg = boards.get(roomId);
    if (!msg || editTimers.has(roomId)) return;
    const t = setTimeout(async () => {
      editTimers.delete(roomId);
      try {
        await msg.edit(await boardPayload(getGame(roomId)));
      } catch {
        /* token expired / message gone */
      }
    }, 1500);
    editTimers.set(roomId, t);
  };
  onChange(scheduleEdit);

  const registerPlayer = (game, user) =>
    game.addPlayer(`discord:${user.id}`, { id: user.id, username: user.username });

  // Shared answer logic (used by /answer, the Answer modal, and the clue picker).
  async function applyAnswer(interaction, game, number, direction, word) {
    const res = game.submitAnswer(interaction.user.id, number, direction, word);
    if (res.error === "no_clue") {
      await interaction.reply({ content: `There's no clue ${number} ${direction}.`, ephemeral: true });
    } else if (res.alreadySolved) {
      await interaction.reply({ content: `Clue ${number} ${direction} is already solved.`, ephemeral: true });
    } else if (!res.correct) {
      await interaction.reply({ content: `❌ \`${word}\` isn't right for ${number} ${direction}.`, ephemeral: true });
    } else {
      const extra = res.newlySolved.length > 1 ? ` (+${res.newlySolved.length - 1} crossing!)` : "";
      const done = res.complete ? "\n🎉 **Puzzle complete!**" : "";
      await interaction.reply(`✅ <@${interaction.user.id}> solved **${number} ${direction}** = **${res.entry.answer}** — +${res.entry.length}${extra}${done}`);
      emitChange(interaction.channelId);
    }
  }

  // Generate a new puzzle and post a fresh board message (the latest board is
  // always at the bottom of the channel; live edits target it).
  async function generateAndShow(channel, roomId, layoutName, difficulty = null) {
    const game = getGame(roomId);
    game.newGame({ layoutName, difficulty });
    const msg = await channel.send(await boardPayload(game));
    boards.set(roomId, msg);
    emitChange(roomId);
    return game;
  }

  // ---------- interaction routing ----------
  client.on("interactionCreate", async (interaction) => {
    const roomId = interaction.channelId;
    const game = getGame(roomId);
    registerPlayer(game, interaction.user);
    try {
      // ----- slash commands -----
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case "crossword": {
            await interaction.deferReply();
            const layout = interaction.options.getString("layout") || "Mini 5x5 - Open";
            const difficulty = interaction.options.getString("difficulty") || null;
            const g = await generateAndShow(interaction.channel, roomId, layout, difficulty);
            await interaction.editReply(`🧩 New **${g.puzzleFull.layoutName}** crossword posted below — answer with **✏️ Answer**.`);
            break;
          }
          case "answer": {
            if (!game.hasPuzzle()) { await interaction.reply({ content: "No puzzle yet — use `/crossword`.", ephemeral: true }); break; }
            await applyAnswer(interaction, game, interaction.options.getInteger("number"), interaction.options.getString("direction"), interaction.options.getString("word"));
            break;
          }
          case "reveal": {
            if (!game.hasPuzzle()) { await interaction.reply({ content: "No puzzle yet — use `/crossword`.", ephemeral: true }); break; }
            const number = interaction.options.getInteger("number");
            const direction = interaction.options.getString("direction");
            const res = game.revealClue(number, direction);
            if (res.error) await interaction.reply({ content: `There's no clue ${number} ${direction}.`, ephemeral: true });
            else { await interaction.reply({ content: `🔎 Revealed **${number} ${direction}** = **${res.entry.answer}** (no points).`, ephemeral: true }); emitChange(roomId); }
            break;
          }
          case "board": {
            const payload = await boardPayload(game);
            const msg = await interaction.reply({ ...payload, fetchReply: true });
            if (game.hasPuzzle()) boards.set(roomId, msg);
            break;
          }
          case "leaderboard": {
            const embed = new EmbedBuilder().setTitle("🏆 Scores").setColor(0xf2c14e)
              .setDescription(renderScores(game) + "\n\n" + renderProgress(game));
            await interaction.reply({ embeds: [embed] });
            break;
          }
        }
        return;
      }

      // ----- buttons -----
      if (interaction.isButton()) {
        if (interaction.customId === "answer") {
          if (!game.hasPuzzle()) { await interaction.reply({ content: "No puzzle yet — press 🔀 New.", ephemeral: true }); return; }
          const modal = new ModalBuilder().setCustomId("answmodal").setTitle("Answer a clue").addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("clue").setLabel("Clue (e.g. 5A or 5 down)").setStyle(TextInputStyle.Short).setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("word").setLabel("Your answer").setStyle(TextInputStyle.Short).setRequired(true),
            ),
          );
          await interaction.showModal(modal);
        } else if (interaction.customId === "new") {
          // Prompt for a layout (ephemeral) instead of a permanent dropdown.
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId("newlayout").setPlaceholder("Choose a layout…").addOptions(
              { label: "🎲 Random", value: "__random__" },
              ...LAYOUTS.slice(0, 24).map((l) => ({ label: l.name, value: l.name })),
            ),
          );
          await interaction.reply({ content: "Pick a layout for the new puzzle:", components: [row], ephemeral: true });
        }
        return;
      }

      // ----- select menus -----
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "cluepick") {
          const [num, dir] = interaction.values[0].split(":");
          const e = game.findEntry(Number(num), dir);
          const modal = new ModalBuilder().setCustomId(`answword:${num}:${dir}`).setTitle(`${num} ${dir}`).addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("word")
                .setLabel((e ? e.clue : "Your answer").slice(0, 45))
                .setStyle(TextInputStyle.Short).setRequired(true),
            ),
          );
          await interaction.showModal(modal);
        } else if (interaction.customId === "newlayout") {
          await interaction.deferUpdate();
          const choice = interaction.values[0];
          const g = await generateAndShow(interaction.channel, roomId, choice === "__random__" ? null : choice);
          await interaction.editReply({ content: `🧩 New **${g.puzzleFull.layoutName}** posted below!`, components: [] });
        }
        return;
      }

      // ----- modal submits -----
      if (interaction.isModalSubmit()) {
        let number, direction;
        const word = interaction.fields.getTextInputValue("word");
        if (interaction.customId === "answmodal") {
          const parsed = parseClue(interaction.fields.getTextInputValue("clue"));
          if (!parsed) { await interaction.reply({ content: "Couldn't read that clue — try e.g. `5A` or `5 down`.", ephemeral: true }); return; }
          ({ number, direction } = parsed);
        } else if (interaction.customId.startsWith("answword:")) {
          const [, n, d] = interaction.customId.split(":");
          number = Number(n); direction = d;
        } else return;
        await applyAnswer(interaction, game, number, direction, word);
        return;
      }
    } catch (e) {
      console.error("[bot] interaction error:", e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
      }
    }
  });

  client.once("clientReady", async (c) => {
    try {
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) await c.application.commands.set(commands, guildId);
      else await c.application.commands.set(commands);
      console.log(`[bot] logged in as ${c.user.tag}; commands registered${guildId ? ` to guild ${guildId}` : " globally"}.`);
    } catch (e) {
      console.error("[bot] command registration failed:", e);
    }
  });

  await client.login(token);
  return client;
}
