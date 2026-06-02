// Optional Discord bot front-end for criss. Plays the SAME game as the Activity
// (shared via gameStore, keyed by channel id), rendered in chat. Only starts if
// DISCORD_BOT_TOKEN is set; discord.js is imported lazily so Activity-only
// deployments don't even need it installed.
import { getGame, emitChange, onChange } from "./gameStore.js";
import { LAYOUTS } from "./crossword/layouts.js";
import { renderGrid, renderClues, renderProgress, renderScores } from "./render.js";
import { renderBoardPNG } from "./renderImage.js";

const trunc = (s, n = 1024) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("[bot] DISCORD_BOT_TOKEN not set — Discord bot disabled (Activity still works).");
    return null;
  }

  const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = await import("discord.js");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const directionOpt = (o) =>
    o.setName("direction").setDescription("across or down").setRequired(true)
      .addChoices({ name: "Across", value: "across" }, { name: "Down", value: "down" });

  const commands = [
    new SlashCommandBuilder()
      .setName("crossword")
      .setDescription("Start a new crossword in this channel")
      .addStringOption((o) =>
        o.setName("layout").setDescription("Grid layout").addChoices(
          ...LAYOUTS.slice(0, 25).map((l) => ({ name: l.name, value: l.name })),
        ),
      )
      .addStringOption((o) =>
        o.setName("difficulty").setDescription("Word difficulty (best-effort)").addChoices(
          { name: "Easy", value: "EASY" },
          { name: "Moderate", value: "MODERATE" },
          { name: "Hard", value: "DIFFICULT" },
        ),
      ),
    new SlashCommandBuilder()
      .setName("answer")
      .setDescription("Answer a clue")
      .addIntegerOption((o) => o.setName("number").setDescription("Clue number").setRequired(true))
      .addStringOption(directionOpt)
      .addStringOption((o) => o.setName("word").setDescription("Your answer").setRequired(true)),
    new SlashCommandBuilder()
      .setName("reveal")
      .setDescription("Reveal a clue's answer (no points)")
      .addIntegerOption((o) => o.setName("number").setDescription("Clue number").setRequired(true))
      .addStringOption(directionOpt),
    new SlashCommandBuilder().setName("board").setDescription("Show the current crossword"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Show the scores"),
  ].map((c) => c.toJSON());

  // ---- rendering ----
  const boardPayload = async (game) => {
    const p = game.puzzleFull;
    if (!p) return { content: "No puzzle yet — use `/crossword` to start one." };
    const sub =
      p.requestedLayout && p.requestedLayout !== p.layoutName
        ? ` (couldn't fill ${p.requestedLayout})`
        : "";
    const embed = new EmbedBuilder()
      .setTitle(`🧩 ${p.layoutName}${sub}`)
      .setColor(game.isComplete() ? 0x2ecc71 : 0x5865f2)
      .setFooter({ text: game.isComplete() ? "Solved! 🎉  /crossword for a new one" : "/answer  ·  /reveal  ·  /board" });

    const png = await renderBoardPNG(game).catch(() => null);
    if (png) {
      // Clues are drawn into the image, so the embed stays clean.
      embed.setDescription(renderProgress(game)).setImage("attachment://board.png")
        .addFields({ name: "Scores", value: trunc(renderScores(game)) });
      return { embeds: [embed], files: [{ attachment: png, name: "board.png" }] };
    }
    // Fallback: ASCII grid + text clue lists if image rendering isn't available.
    embed
      .setDescription("```\n" + renderGrid(game) + "\n```\n" + renderProgress(game))
      .addFields(
        { name: "Across", value: trunc(renderClues(game, "across")), inline: true },
        { name: "Down", value: trunc(renderClues(game, "down")), inline: true },
        { name: "Scores", value: trunc(renderScores(game)) },
      );
    return { embeds: [embed], files: [] };
  };

  // The live board message per channel (so the Activity and bot edits show up).
  const boards = new Map(); // roomId -> Message
  const editTimers = new Map();
  const scheduleEdit = (roomId) => {
    const msg = boards.get(roomId);
    if (!msg || editTimers.has(roomId)) return; // coalesce rapid changes
    const t = setTimeout(async () => {
      editTimers.delete(roomId);
      try {
        await msg.edit(await boardPayload(getGame(roomId)));
      } catch {
        /* token expired / message gone — /board reposts */
      }
    }, 1500);
    editTimers.set(roomId, t);
  };
  // Any change to a channel's game (bot OR Activity) refreshes the board message.
  onChange(scheduleEdit);

  const registerPlayer = (game, user) =>
    game.addPlayer(`discord:${user.id}`, { id: user.id, username: user.username });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const roomId = interaction.channelId;
    const game = getGame(roomId);
    registerPlayer(game, interaction.user);

    try {
      switch (interaction.commandName) {
        case "crossword": {
          await interaction.deferReply();
          const layout = interaction.options.getString("layout") || "Mini 5x5 - Open";
          const difficulty = interaction.options.getString("difficulty") || null;
          game.generating = true;
          game.newGame({ layoutName: layout, difficulty });
          game.generating = false;
          const msg = await interaction.channel.send(await boardPayload(game));
          boards.set(roomId, msg);
          await interaction.editReply(`🧩 New **${game.puzzleFull.layoutName}** crossword — answer with \`/answer\`.`);
          emitChange(roomId);
          break;
        }
        case "answer": {
          if (!game.hasPuzzle()) {
            await interaction.reply({ content: "No puzzle yet — use `/crossword`.", ephemeral: true });
            break;
          }
          const number = interaction.options.getInteger("number");
          const direction = interaction.options.getString("direction");
          const word = interaction.options.getString("word");
          const res = game.submitAnswer(interaction.user.id, number, direction, word);
          if (res.error === "no_clue") {
            await interaction.reply({ content: `There's no clue ${number} ${direction}.`, ephemeral: true });
          } else if (res.alreadySolved) {
            await interaction.reply({ content: `Clue ${number} ${direction} is already solved.`, ephemeral: true });
          } else if (!res.correct) {
            await interaction.reply({ content: `❌ \`${word}\` isn't right for ${number} ${direction}.`, ephemeral: true });
          } else {
            const pts = res.entry.length;
            const extra = res.newlySolved.length > 1 ? ` (+${res.newlySolved.length - 1} crossing!)` : "";
            const done = res.complete ? "\n🎉 **Puzzle complete!**" : "";
            await interaction.reply(`✅ <@${interaction.user.id}> solved **${number} ${direction}** with **${res.entry.answer}** — +${pts}${extra}${done}`);
            emitChange(roomId);
          }
          break;
        }
        case "reveal": {
          if (!game.hasPuzzle()) {
            await interaction.reply({ content: "No puzzle yet — use `/crossword`.", ephemeral: true });
            break;
          }
          const number = interaction.options.getInteger("number");
          const direction = interaction.options.getString("direction");
          const res = game.revealClue(number, direction);
          if (res.error) await interaction.reply({ content: `There's no clue ${number} ${direction}.`, ephemeral: true });
          else {
            await interaction.reply({ content: `🔎 Revealed **${number} ${direction}** = **${res.entry.answer}** (no points).`, ephemeral: true });
            emitChange(roomId);
          }
          break;
        }
        case "board": {
          const payload = await boardPayload(game);
          const msg = await interaction.reply({ ...payload, fetchReply: true });
          if (game.hasPuzzle()) boards.set(roomId, msg);
          break;
        }
        case "leaderboard": {
          const embed = new EmbedBuilder()
            .setTitle("🏆 Scores")
            .setColor(0xf2c14e)
            .setDescription(renderScores(game) + "\n\n" + renderProgress(game));
          await interaction.reply({ embeds: [embed] });
          break;
        }
      }
    } catch (e) {
      console.error("[bot] command error:", e);
      if (interaction.deferred || interaction.replied) interaction.editReply("Something went wrong.").catch(() => {});
      else interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
    }
  });

  client.once("clientReady", async (c) => {
    try {
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) await c.application.commands.set(commands, guildId); // instant in one guild
      else await c.application.commands.set(commands); // global (up to ~1h to appear)
      console.log(`[bot] logged in as ${c.user.tag}; commands registered${guildId ? ` to guild ${guildId}` : " globally"}.`);
    } catch (e) {
      console.error("[bot] command registration failed:", e);
    }
  });

  await client.login(token);
  return client;
}
