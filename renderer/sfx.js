'use strict';
// Sonidos sintetizados (sin archivos). Todo pasa por un limitador suave y un volumen maestro.
window.sfx = (() => {
  let ctx = null, master = null, enabled = true, lastHover = 0;

  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone({ f = 440, to = null, t = 0, d = 0.12, type = 'sine', v = 0.18, a = 0.006 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + d + 0.03);
  }

  function whoosh({ t = 0, d = 0.35, v = 0.12, from = 300, to = 3200 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + t;
    const len = Math.floor(ctx.sampleRate * d);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t0); bp.frequency.exponentialRampToValueAtTime(to, t0 + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + d * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
  }

  const N = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, A4: 440, D5: 587.33 };

  return {
    setEnabled(v) { enabled = !!v; if (enabled) ensure(); },
    get enabled() { return enabled; },
    click() { tone({ f: 620, to: 380, d: 0.07, type: 'triangle', v: 0.13 }); },
    hover() { const n = performance.now(); if (n - lastHover < 70) return; lastHover = n; tone({ f: 1500, d: 0.025, v: 0.025, type: 'sine' }); },
    tab() { whoosh({ d: 0.22, v: 0.07, from: 500, to: 2200 }); tone({ f: 330, to: 440, d: 0.1, v: 0.07, type: 'triangle' }); },
    open() { whoosh({ d: 0.3, v: 0.09, from: 250, to: 2600 }); tone({ f: 440, to: 660, d: 0.14, v: 0.08, type: 'triangle', t: 0.04 }); },
    close() { whoosh({ d: 0.22, v: 0.07, from: 2400, to: 300 }); },
    paste() { tone({ f: 520, d: 0.05, v: 0.1, type: 'square' }); tone({ f: 780, d: 0.06, v: 0.08, type: 'square', t: 0.05 }); },
    scan() { for (let i = 0; i < 4; i++) tone({ f: 420 + i * 90, d: 0.05, v: 0.06, type: 'square', t: i * 0.06 }); },
    found() { tone({ f: N.G5, d: 0.14, v: 0.14, type: 'triangle' }); tone({ f: N.C6, d: 0.28, v: 0.14, type: 'triangle', t: 0.09 }); },
    start() { whoosh({ d: 0.4, v: 0.1, from: 200, to: 3600 }); tone({ f: N.C5, to: N.G5, d: 0.2, v: 0.11, type: 'sawtooth', t: 0.02 }); },
    done() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone({ f, d: 0.32, v: 0.13, type: 'triangle', t: i * 0.075 })); },
    error() { tone({ f: 190, to: 120, d: 0.28, v: 0.16, type: 'sawtooth' }); tone({ f: 140, to: 90, d: 0.34, v: 0.14, type: 'sawtooth', t: 0.12 }); },
    toggle(on) { tone({ f: on ? 700 : 420, d: 0.07, v: 0.12, type: 'triangle' }); },
  };
})();
