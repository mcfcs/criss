// Thin WebSocket client with auto-reconnect. Same-origin /ws (proxied to the
// game server in dev, routed by the Activity URL mapping in Discord).

export function connect({ room, user, onState, onError }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  let ws;
  let closed = false;

  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", room, user }));
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "state") onState(m);
      else if (m.type === "error") onError?.(m.message);
    };
    ws.onclose = () => {
      if (!closed) setTimeout(open, 1000);
    };
    ws.onerror = () => ws.close();
  };
  open();

  return {
    send: (obj) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)),
    close: () => {
      closed = true;
      ws?.close();
    },
  };
}
