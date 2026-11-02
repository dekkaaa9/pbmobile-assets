// Probe origin ports for WebSocket services
const ports = [8766, 3000, 8080];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probePort(port) {
  const out = [];
  await new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(`ws://149.33.27.134:${port}`);
    } catch (e) {
      out.push("[ctor-err] " + e.message);
      return resolve();
    }
    let finished = false;
    const end = (why) => {
      if (finished) return;
      finished = true;
      try { ws.close(); } catch {}
      resolve();
    };
    ws.onopen = () => out.push("[open]");
    ws.onmessage = (e) => {
      const d = String(e.data);
      out.push("[msg] " + (d.length > 400 ? d.slice(0, 400) + " …" : d));
    };
    ws.onerror = (e) => out.push("[err] " + (e.message || e.error?.message || "?"));
    ws.onclose = (e) => { out.push(`[close] code=${e.code} reason=${e.reason || "-"}`); end(); };
    setTimeout(end, 5000);
    ws.onopen = async () => {
      out.push("[open]");
      try {
        ws.send(JSON.stringify({ t: "hello", nick: "recon" + Math.floor(Math.random() * 1e6), plat: "pc", sts: 1, bin: 1 }));
      } catch (e) { out.push("[send-err] " + e.message); }
      await sleep(2500);
    };
  });
  console.log(`\n##### ws://149.33.27.134:${port} #####`);
  for (const l of out) console.log(l);
}

(async () => {
  for (const p of ports) await probePort(p);
  process.exit(0);
})();
