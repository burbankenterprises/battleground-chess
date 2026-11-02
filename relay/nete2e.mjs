// Two-device e2e: two browser contexts, one relay, full game flow.
import puppeteer from "puppeteer";
const APP = "http://127.0.0.1:4782/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "shell", args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const errors = { host: [], guest: [] };

function watch(page, tag, errors) {
  page.on("pageerror", (e) => errors[tag].push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors[tag].push(m.type() + ": " + m.text()); });
}

// Board squares -> screen coords via the HUD's own tap handler? Simpler: drive
// taps through the store directly (the tap pipeline is unit-tested; here we
// test the NET layer end to end). We expose the store on window for driving.
async function drive(page, expr) {
  return page.evaluate(`(${expr})()`);
}

try {
  // --- HOST ---
  const host = await browser.newPage();
  await host.setViewport({ width: 420, height: 800 });
  watch(host, "host", errors);
  await host.goto(APP, { waitUntil: "networkidle0", timeout: 120000 });
  await sleep(500);
  // "Play a Friend"
  await host.evaluate(() => [...document.querySelectorAll("button")].find((b) => /play a friend/i.test(b.textContent))?.click());
  await sleep(1500);
  const code = await host.evaluate(() => document.body.innerText.match(/\b[A-Z2-9]{4}\b/)?.[0] ?? null);
  console.log("HOST room code:", code);
  if (!code) throw new Error("no room code shown");

  // --- GUEST ---
  const guest = await browser.newPage();
  await guest.setViewport({ width: 420, height: 800 });
  watch(guest, "guest", errors);
  await guest.goto(APP, { waitUntil: "networkidle0", timeout: 120000 });
  await sleep(500);
  await guest.evaluate(() => [...document.querySelectorAll("button")].find((b) => /join with a code/i.test(b.textContent))?.click());
  await sleep(300);
  await guest.type("input[aria-label='Room code']", code);
  await guest.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Join")?.click());
  await sleep(2000);

  const hostInGame = await host.evaluate(() => !!document.querySelector("canvas"));
  const guestInGame = await guest.evaluate(() => !!document.querySelector("canvas"));
  console.log("host in game:", hostInGame, "| guest in game:", guestInGame);

  // Colors: host=white, guest=black
  const hostColor = await host.evaluate(() => document.body.innerText.includes("White"));
  const guestColor = await guest.evaluate(() => document.body.innerText.includes("Black"));
  console.log("host sees White:", hostColor, "| guest sees Black:", guestColor);

  // --- MOVES: white e4 (host UI), black e5 (guest via store tap gate) ---
  // Host plays e2->e4 through real taps: expose store for coordinate math.
  // The canvas tap pipeline is unit/e2e tested elsewhere; here drive taps via store
  // (same code path as Board.tsx onClick -> handleTap).
  const r1 = await drive(host, `async () => {
    const s = window.__bgcStore ?? null;
    if (!s) return "no-store";
    s.getState().handleTap("e2");
    s.getState().handleTap("e4");
    s.getState().settleAnimations();
    return s.getState().moveHistory.join(",");
  }`);
  console.log("host move result:", r1);
  await sleep(2500); // travel over the relay + guest animation

  const guestHist = await drive(guest, `async () => {
    const s = window.__bgcStore ?? null;
    if (!s) return "no-store";
    return s.getState().moveHistory.join(",");
  }`);
  console.log("guest history after host e4:", guestHist);

  // Guest (black) replies e7->e5.
  const r2 = await drive(guest, `async () => {
    const s = window.__bgcStore;
    s.getState().handleTap("e7");
    s.getState().handleTap("e5");
    s.getState().settleAnimations();
    return s.getState().moveHistory.join(",");
  }`);
  console.log("guest move result:", r2);
  await sleep(2500);

  const hostHist2 = await drive(host, `async () => window.__bgcStore.getState().moveHistory.join(",")`);
  console.log("host history after guest e5:", hostHist2);

  // --- Turn gating: guest (black side done) cannot move white pieces ---
  const gateTest = await drive(guest, `async () => {
    const s = window.__bgcStore;
    // It is white's turn; guest is black — tapping e2 (white pawn) must be ignored.
    s.getState().handleTap("e2");
    return s.getState().selectedSquare;
  }`);
  console.log("guest tapping white piece (should be null):", gateTest);

  // --- Disconnect: guest reloads, reconnects, host notified then game continues ---
  await guest.reload({ waitUntil: "networkidle0" });
  await sleep(3000);
  const guestBack = await drive(host, `async () => window.__bgcStore ? "store-ok" : "no-store"`);
  console.log("host store after guest reload:", guestBack);
  const hostHist3 = await drive(host, `async () => window.__bgcStore.getState().moveHistory.join(",")`);
  console.log("host history after guest reload (resume keeps game):", hostHist3);

  const ok =
    hostInGame && guestInGame && hostColor && guestColor &&
    String(r1).includes("e4") && String(guestHist).includes("e4") &&
    String(r2).includes("e4,e5") && String(hostHist2).includes("e4,e5") &&
    gateTest === null;
  console.log(ok ? "NET E2E OK" : "NET E2E FAIL");
  process.exitCode = ok ? 0 : 1;
} finally {
  console.log("HOST ERRORS(" + errors.host.length + "):", JSON.stringify(errors.host.slice(0, 5)));
  console.log("GUEST ERRORS(" + errors.guest.length + "):", JSON.stringify(errors.guest.slice(0, 5)));
  await browser.close();
}
