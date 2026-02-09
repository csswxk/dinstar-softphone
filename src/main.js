import {
  UserAgent,
  Registerer,
  Inviter,
  Invitation,
  SessionState,
  UserAgentState,
  RegistererState
} from "sip.js/lib/api/index.js";

/**
 * Notes for Dinstar:
 * - Use WS/WSS transport from the PBX (System → SIP → Transport).
 * - Enable WebRTC on the extension (PBX → Extensions → Edit → WebRTC).
 * - Codecs: Opus + PCMU are usually safest for WebRTC.
 * - If using WSS, you must have a valid cert (or accept self-signed carefully).
 */

const els = {
  uaState: document.getElementById("uaState"),
  regState: document.getElementById("regState"),
  callState: document.getElementById("callState"),
  log: document.getElementById("log"),
  pbxHost: document.getElementById("pbxHost"),
  wsUrl: document.getElementById("wsUrl"),
  useStun: document.getElementById("useStun"),
  stunServer: document.getElementById("stunServer"),
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

let userAgent = null;
let registerer = null;
let currentSession = null;   // Inviter or Invitation
let pendingInvitation = null;

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

async function attachMedia(session) {
  // SIP.js provides a PeerConnection through sessionDescriptionHandler
  const sdh = session.sessionDescriptionHandler;
  if (!sdh || !sdh.peerConnection) {
    log("No sessionDescriptionHandler/peerConnection yet.");
    return;
  }

  const pc = sdh.peerConnection;

  // Remote audio
  const remoteStream = new MediaStream();
  pc.getReceivers().forEach(r => {
    if (r.track && r.track.kind === "audio") remoteStream.addTrack(r.track);
  });
  els.remoteAudio.srcObject = remoteStream;

  // Local mic (optional monitor)
  const localStream = new MediaStream();
  pc.getSenders().forEach(s => {
    if (s.track && s.track.kind === "audio") localStream.addTrack(s.track);
  });
  els.localAudio.srcObject = localStream;

  log("Media attached (local+remote).");
}

function wireSession(session) {
  currentSession = session;

  session.stateChange.addListener(async (state) => {
    log("Session state:", state);

    switch (state) {
      case SessionState.Initial:
        setCallState("initial");
        enableCallControls({ canAnswer: false, inCall: false });
        break;

      case SessionState.Establishing:
        setCallState("establishing");
        enableCallControls({ canAnswer: false, inCall: true });
        break;

      case SessionState.Established:
        setCallState("established");
        enableCallControls({ canAnswer: false, inCall: true });
        // Wait a tick then attach media (pc receivers/senders available)
        setTimeout(() => attachMedia(session).catch(console.error), 300);
        break;

      case SessionState.Terminated:
        setCallState("terminated");
        enableCallControls({ canAnswer: false, inCall: false });
        pendingInvitation = null;
        currentSession = null;
        els.remoteAudio.srcObject = null;
        els.localAudio.srcObject = null;
        break;
    }
  });
}

async function startUA() {
  setUaState("starting");
  const pbxHost = els.pbxHost.value.trim();
  const ext = els.ext.value.trim();
  const pwd = els.pwd.value;
  const wsUrl = els.wsUrl.value.trim();
  const useStun = !!els.useStun.checked;
  const stunServer = els.stunServer.value.trim();

  if (!pbxHost || !ext || !pwd || !wsUrl) {
    alert("Please fill PBX Host, WS URL, Extension, Password.");
    return;
  }

  const uri = UserAgent.makeURI(`sip:${ext}@${pbxHost}`);
  if (!uri) throw new Error("Invalid URI");

  userAgent = new UserAgent({
    uri,
    transportOptions: {
      server: wsUrl,
    },
    authorizationUsername: ext,
    authorizationPassword: pwd,

    // Ask for mic access on demand
    sessionDescriptionHandlerFactoryOptions: {
      constraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      },
      peerConnectionConfiguration: {
        // For LAN tests, leave STUN off to avoid public IP candidates.
        iceServers: useStun && stunServer ? [{ urls: stunServer }] : []
      }
    }
  });

  userAgent.stateChange.addListener((s) => {
    log("UA state:", s);
    if (s === UserAgentState.Started) {
      setUaState("started");
    } else if (s === UserAgentState.Stopped) {
      setUaState("stopped");
    } else {
      setUaState(String(s));
    }
  });

  userAgent.delegate = {
    onInvite: async (invitation) => {
      log("Incoming call!");
      pendingInvitation = invitation;

      wireSession(invitation);
      setCallState("incoming");
      enableCallControls({ canAnswer: true, inCall: true });
    }
  };

  registerer = new Registerer(userAgent);
  registerer.stateChange.addListener((s) => {
    log("Registerer state:", s);
    if (s === RegistererState.Registered) {
      setRegState("registered");
    } else if (s === RegistererState.Unregistered) {
      setRegState("not registered");
    } else if (s === RegistererState.Terminated) {
      setRegState("failed");
    }
  });

  try {
    await userAgent.start();
    setUaState("started");
    log("UA started.");
  } catch (e) {
    setUaState("failed");
    throw e;
  }
}

async function stopUA() {
  try {
    if (registerer) {
      await registerer.unregister().catch(() => { });
    }
    if (userAgent) {
      await userAgent.stop();
    }
  } finally {
    userAgent = null;
    registerer = null;
    pendingInvitation = null;
    currentSession = null;
    setUaState("stopped");
    setRegState("not registered");
    setCallState("idle");
    enableCallControls({ canAnswer: false, inCall: false });
    log("UA stopped.");
  }
}

async function doRegister() {
  if (!registerer) return alert("Start UA first.");
  setRegState("registering");
  await registerer.register();
  log("Register request sent.");
}

async function doUnregister() {
  if (!registerer) return alert("Start UA first.");
  setRegState("unregistering");
  await registerer.unregister();
  log("Unregister request sent.");
}

function formatSipResponse(response) {
  const msg = response?.message ?? response;
  const code = msg?.statusCode ?? "unknown";
  const reason = msg?.reasonPhrase ?? "";
  return `${code} ${reason}`.trim();
}

async function doCall() {
  if (!userAgent) return alert("Start UA first.");
  const pbxHost = els.pbxHost.value.trim();
  const target = els.dialTo.value.trim();
  if (!target) return alert("Enter a target extension/number.");

  const targetUri = UserAgent.makeURI(`sip:${target}@${pbxHost}`);
  if (!targetUri) return alert("Invalid target.");

  const inviter = new Inviter(userAgent, targetUri, {
    // You can add earlyMedia / extraHeaders here if needed
  });

  wireSession(inviter);

  // Browser requires user gesture for mic; calling from a click is OK.
  await inviter.invite({
    requestDelegate: {
      onAccept: (response) => log("INVITE accepted:", formatSipResponse(response)),
      onReject: (response) => log("INVITE rejected:", formatSipResponse(response)),
      onProgress: (response) => log("INVITE progress:", formatSipResponse(response)),
    }
  });
  log("Calling", target);
}

async function doAnswer() {
  if (!pendingInvitation) return;
  const invitation = pendingInvitation;

  // Accept incoming call
  await invitation.accept();
  log("Call answered.");
  enableCallControls({ canAnswer: false, inCall: true });
}

async function doHangup() {
  const session = currentSession || pendingInvitation;
  if (!session) return;

  try {
    if (session instanceof Inviter) {
      await session.cancel(); // if still ringing
    } else if (session instanceof Invitation) {
      // If incoming and not accepted: reject; else: bye
      if (session.state === SessionState.Establishing) {
        await session.reject();
      } else {
        await session.bye();
      }
    } else {
      // Fallback
      await session.bye?.();
    }
  } catch (e) {
    log("Hangup error:", String(e));
  }

  log("Hangup.");
}

function setMute(muted) {
  const session = currentSession || pendingInvitation;
  if (!session) return;

  const sdh = session.sessionDescriptionHandler;
  const pc = sdh?.peerConnection;
  if (!pc) return;

  pc.getSenders().forEach(sender => {
    if (sender.track && sender.track.kind === "audio") {
      sender.track.enabled = !muted;
    }
  });

  log(muted ? "Muted." : "Unmuted.");
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
