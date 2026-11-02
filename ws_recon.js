// Passive WS recon: hello handshake, lobby query, and a few unauthenticated probes.
const URL = "wss://pbmobile.app/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(tag) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const log = [];
    let done = false;
    const fin = (why) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve({ tag, log, why });
    };
    ws.onopen = () => log.push("[open]");
    ws.onmessage = (e) => {
      const d = String(e.data);
      log.push("[msg] " + (d.length > 1200 ? d.slice(0, 1200) + ` …(+${d.length - 1200})` : d));
    };
    ws.onerror = (e) => log.push("[err] " + (e.message || e.error?.message || "?"));
    ws.onclose = (e) => { log.push(`[close] code=${e.code} reason=${e.reason || "-"}`); fin("close"); };
    setTimeout(() => fin("timeout"), 9000);
    return { ws, log };
  });
}

(async () => {
  // --- Probe 1: plain guest hello ---
  {
    const p = mk("hello-guest");
    await sleep(300);
    // grab the ws from the promise closure is not exposed; re-do inline instead
  }
})().catch(() => {});

// Simpler: explicit sequential probes
async function probe(name, sendFn, waitMs = 6000) {
  const out = [];
  await new Promise((resolve) => {
    const ws = new WebSocket(URL);
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
      out.push("[msg] " + (d.length > 1500 ? d.slice(0, 1500) + ` …(+${d.length - 1500})` : d));
    };
    ws.onerror = (e) => out.push("[err] " + (e.message || e.error?.message || "?"));
    ws.onclose = (e) => { out.push(`[close] code=${e.code} reason=${e.reason || "-"}`); end("close"); };
    setTimeout(end, waitMs);
    ws.onopen = async () => {
      out.push("[open]");
      try { await sendFn(ws); } catch (e) { out.push("[send-err] " + e.message); }
    };
  });
  console.log(`\n########## ${name} ##########`);
  for (const l of out) console.log(l);
}

(async () => {
  const nick = "recon" + Math.floor(Math.random() * 1e6);

  await probe("1. GUEST HELLO", async (ws) => {
    ws.send(JSON.stringify({ t: "hello", nick, plat: "pc", sts: 1, bin: 1 }));
    await sleep(2500);
    ws.send(JSON.stringify({ t: "rooms" }));
    await sleep(2500);
  });

  await probe("2. RESUME with bogus sid/tok", async (ws) => {
    ws.send(JSON.stringify({ t: "resume", sid: "deadbeefdeadbeef", tok: "0000000000000000", nick, plat: "pc", sts: 1, bin: 1 }));
    await sleep(3000);
  });

  await probe("3. Malformed JSON", async (ws) => {
    ws.send("{{{not json");
    await sleep(1500);
    ws.send(JSON.stringify({ t: "definitely_not_a_type_xyz" }));
    await sleep(2000);
  });

  await probe("4. Unauthenticated admin-ish probes", async (ws) => {
    ws.send(JSON.stringify({ t: "hello", nick, plat: "pc", sts: 1, bin: 1 }));
    await sleep(2000);
    ws.send(JSON.stringify({ t: "admin", op: "list" }));
    await sleep(1200);
    ws.send(JSON.stringify({ t: "admban", id: 1 }));
    await sleep(1200);
    ws.send(JSON.stringify({ t: "who" }));
    await sleep(2000);
  });

  process.exit(0);
})();
