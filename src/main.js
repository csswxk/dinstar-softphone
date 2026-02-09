/**
 * Baresip (SIP/UDP + RTP) frontend.
 */

const els = {
  uaState: document.getElementById("uaState"),
  regState: document.getElementById("regState"),
  callState: document.getElementById("callState"),
  log: document.getElementById("log"),
  pbxHost: document.getElementById("pbxHost"),
  ext: document.getElementById("ext"),
  pwd: document.getElementById("pwd"),
  dialTo: document.getElementById("dialTo"),
  remoteAudio: document.getElementById("remoteAudio"),
  localAudio: document.getElementById("localAudio"),
  btnStart: document.getElementById("btnStart"),
  btnStop: document.getElementById("btnStop"),
  btnRegister: document.getElementById("btnRegister"),
  btnUnregister: document.getElementById("btnUnregister"),
  btnCall: document.getElementById("btnCall"),
  btnAnswer: document.getElementById("btnAnswer"),
  btnHangup: document.getElementById("btnHangup"),
  btnMute: document.getElementById("btnMute"),
  btnUnmute: document.getElementById("btnUnmute"),
};

const usingBaresip = typeof window !== "undefined" && !!window.baresip;

function log(...args) {
  const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ");
  console.log(...args);
  els.log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n` + els.log.textContent;
}

function setText(el, v) { el.textContent = v; }

function setPill(el, text, level) {
  setText(el, text);
  el.classList.remove("ok", "warn", "bad");
  if (level) el.classList.add(level);
}

function setCallState(v) {
  const level = v === "established" ? "ok" : v === "idle" ? "warn" : "bad";
  setPill(els.callState, v, level);
}
function setUaState(v) {
  const level = v === "started" ? "ok" : v === "stopped" ? "bad" : "warn";
  setPill(els.uaState, v, level);
  els.btnStart.classList.toggle("btn-ok", v === "started");
}
function setRegState(v) {
  const level = v === "registered" ? "ok" : v === "failed" ? "bad" : "warn";
  setPill(els.regState, v, level);
  els.btnRegister.classList.toggle("btn-ok", v === "registered");
}

function enableCallControls({ canAnswer, inCall }) {
  els.btnAnswer.disabled = !canAnswer;
  els.btnHangup.disabled = !inCall;
  els.btnMute.disabled = !inCall;
  els.btnUnmute.disabled = !inCall;
}

let startUA;
let stopUA;
let doRegister;
let doUnregister;
let doCall;
let doAnswer;
let doHangup;

if (usingBaresip) {
  window.baresip.onLog((line) => log(line));
  window.baresip.onState((state) => {
    if (state.ua) setUaState(state.ua);
    if (state.reg) setRegState(state.reg);
    if (state.call) {
      setCallState(state.call);
      if (state.call === "incoming") {
        enableCallControls({ canAnswer: true, inCall: true });
      } else if (state.call === "established" || state.call === "establishing") {
        enableCallControls({ canAnswer: false, inCall: true });
      } else {
        enableCallControls({ canAnswer: false, inCall: false });
      }
    }
  });

  startUA = async () => {
    setUaState("starting");
    const pbxHost = els.pbxHost.value.trim();
    const ext = els.ext.value.trim();
    const pwd = els.pwd.value;
    const displayName = ext;

    if (!pbxHost || !ext || !pwd) {
      alert("Please fill PBX Host, Extension, Password.");
      return;
    }

    const account = `sip:${ext}@${pbxHost};auth_user=${ext};auth_pass=${pwd};display_name=${displayName}`;
    await window.baresip.start({ account });
    setUaState("started");
    log("baresip started.");
  };

  stopUA = async () => {
    await window.baresip.stop();
    setUaState("stopped");
    setRegState("not registered");
    setCallState("idle");
    log("baresip stopped.");
  };

  doRegister = async () => {
    if (els.uaState.textContent !== "started") {
      alert("Start UA first and wait for UA to be ready.");
      return;
    }
    setRegState("registering");
    await window.baresip.command("/uareg 300");
    log("Register request sent.");
  };

  doUnregister = async () => {
    setRegState("unregistering");
    await window.baresip.command("/uareg 0");
    log("Unregister request sent.");
  };

  doCall = async () => {
    const pbxHost = els.pbxHost.value.trim();
    const target = els.dialTo.value.trim();
    if (!target) return alert("Enter a target extension/number.");
    const uri = `sip:${target}@${pbxHost}`;
    await window.baresip.command(`/dial ${uri}`);
    log("Calling", target);
  };

  doAnswer = async () => {
    await window.baresip.command("/accept");
    log("Call answered.");
  };

  doHangup = async () => {
    await window.baresip.command("/hangup");
    log("Hangup.");
  };
} else {
  log("Baresip is not available. Run this in Electron with baresip installed.");
  startUA = async () => alert("Baresip not available. Run in Electron.");
  stopUA = async () => {};
  doRegister = async () => {};
  doUnregister = async () => {};
  doCall = async () => {};
  doAnswer = async () => {};
  doHangup = async () => {};
}

function setMute(muted) {
  log("Mute/unmute handled by baresip. Use its CLI if needed.");
}

els.btnStart.addEventListener("click", () => startUA().catch(e => log("Start error:", String(e))));
els.btnStop.addEventListener("click", () => stopUA().catch(e => log("Stop error:", String(e))));
els.btnRegister.addEventListener("click", () => doRegister().catch(e => log("Register error:", String(e))));
els.btnUnregister.addEventListener("click", () => doUnregister().catch(e => log("Unregister error:", String(e))));
els.btnCall.addEventListener("click", () => doCall().catch(e => log("Call error:", String(e))));
els.btnAnswer.addEventListener("click", () => doAnswer().catch(e => log("Answer error:", String(e))));
els.btnHangup.addEventListener("click", () => doHangup().catch(e => log("Hangup error:", String(e))));
els.btnMute.addEventListener("click", () => setMute(true));
els.btnUnmute.addEventListener("click", () => setMute(false));

enableCallControls({ canAnswer: false, inCall: false });
setUaState("stopped");
setRegState("not registered");
setCallState("idle");
log("Ready. Fill PBX host/ws and start UA.");
