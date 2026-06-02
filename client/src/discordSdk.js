// Discord Embedded App SDK bootstrap with a local-browser fallback.
//
// Inside Discord the Activity is loaded in an iframe with a `frame_id` query
// param. When that's absent we're in a normal browser (local dev) and skip the
// Discord handshake entirely, returning a guest identity so the game is fully
// playable without Discord.

function localIdentity() {
  const params = new URLSearchParams(location.search);
  let id = localStorage.getItem("criss_guest_id");
  if (!id) {
    id = "guest-" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("criss_guest_id", id);
  }
  const username =
    params.get("name") || localStorage.getItem("criss_guest_name") || "Player-" + id.slice(-4);
  localStorage.setItem("criss_guest_name", username);
  const room = params.get("room") || "local-lobby";
  return { mode: "local", user: { id, username }, room };
}

export async function initSession() {
  const isEmbedded = new URLSearchParams(location.search).has("frame_id");
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

  if (!isEmbedded || !clientId) {
    return localIdentity();
  }

  // Lazy-import so local dev doesn't need the SDK installed/bundled to run.
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds"],
  });

  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await res.json();
  const auth = await sdk.commands.authenticate({ access_token });

  return {
    mode: "discord",
    sdk,
    user: {
      id: auth.user.id,
      username: auth.user.global_name || auth.user.username,
    },
    // Everyone in the same Activity instance shares a board.
    room: sdk.instanceId,
  };
}
