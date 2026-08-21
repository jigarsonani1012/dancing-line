      import * as THREE from "three";

      /* ================================================================
         0. UTILITIES
         ================================================================ */
      const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
      const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
      const easeOutBack = (u) => { const c = 1.70158, x = u - 1; return 1 + (c + 1) * x * x * x + c * x * x; };
      const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
      const hex = (n) => "#" + n.toString(16).padStart(6, "0");
      function mulberry32(a) {
        return function () {
          a |= 0; a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

      function mergeBoxes(boxes) {
        const base = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
        const bp = base.getAttribute("position").array, bn = base.getAttribute("normal").array, n = bp.length;
        const pos = new Float32Array(n * boxes.length), nor = new Float32Array(n * boxes.length);
        boxes.forEach((b, i) => {
          for (let j = 0; j < n; j += 3) {
            const o = i * n + j;
            pos[o] = bp[j] * b.sx + b.x; pos[o + 1] = bp[j + 1] * b.sy + b.y; pos[o + 2] = bp[j + 2] * b.sz + b.z;
            nor[o] = bn[j]; nor[o + 1] = bn[j + 1]; nor[o + 2] = bn[j + 2];
          }
        });
        base.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        return g;
      }
      const FONT = {
        0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
        3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
        6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "001", "001", "001"], 8: ["111", "101", "111", "101", "111"],
        9: ["111", "101", "111", "001", "111"], "%": ["101", "001", "010", "100", "101"],
      };
      function textGeometry(str, px, depth) {
        const boxes = []; let cx = 0;
        for (const ch of str) {
          const rows = FONT[ch]; if (!rows) { cx += px * 2; continue; }
          rows.forEach((row, r) => { for (let c = 0; c < 3; c++) if (row[c] === "1") boxes.push({ x: cx + c * px + px / 2, y: (4 - r) * px + px / 2, z: 0, sx: px * 1.03, sy: px * 1.03, sz: depth }); });
          cx += 4 * px;
        }
        const w = cx - px, h = 5 * px;
        for (const b of boxes) { b.x -= w / 2; b.y -= h / 2; }
        return { geo: mergeBoxes(boxes), w, h };
      }
      const MARKER_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 1).normalize(), new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(0, 1, 0)));
      const WHITE = new THREE.Color(0xffffff);
      const CAM_OFF = { x: -9, y: 13, z: -9 };

      /* ================================================================
         1. SKINS (Line Skins)
         ================================================================ */
      const SKINS = [
        { id: "default", name: "Classic", color: null, cost: 0 },
        { id: "light", name: "Light", color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.65, cost: 30 },
        { id: "fire", name: "Ball of Fire", color: 0xff4d26, cost: 50 },
        { id: "gold", name: "Golden", color: 0xffd166, cost: 75 },
        { id: "neon", name: "Cyber Neon", color: 0x4cc9f0, cost: 100 },
        { id: "ruby", name: "Ruby Gem", color: 0xff2a7a, cost: 150 },
      ];

      /* ================================================================
         2. AUDIO ENGINE — Rich layered synthesis
         ================================================================ */
      class MusicEngine {
        constructor() {
          this.ctx = null; this.song = null; this.timer = null; this.playing = false; this.muted = false;
          this.musicOn = true; this.sfxOn = true; this.curVol = 0.55; this.beatSec = 0.5; this.startTime = 0; this.step = 0; this.next = 0;
        }
        unlock() { if (!this.ctx) this.init(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
        init() {
          const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
          const ctx = (this.ctx = new Ctx());
          const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.attack.value = 0.004; comp.release.value = 0.2; comp.connect(ctx.destination);
          this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(comp);
          this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0001; this.musicBus.connect(this.master);
          this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0.0001; this.sfxBus.connect(this.master);

          const delay = ctx.createDelay(1); delay.delayTime.value = 0.24;
          const fb = ctx.createGain(); fb.gain.value = 0.35;
          const damp = ctx.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 2600;
          const wet = ctx.createGain(); wet.gain.value = 0.45;
          this.echoMusic = ctx.createGain(); this.echoMusic.gain.value = this.musicOn ? 1 : 0; this.echoMusic.connect(delay);
          this.echoSfx = ctx.createGain(); this.echoSfx.gain.value = this.sfxOn ? 1 : 0; this.echoSfx.connect(delay);
          delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet); wet.connect(this.master);

          const irLen = Math.floor(ctx.sampleRate * 2.1);
          const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
          for (let ch = 0; ch < 2; ch++) {
            const data = ir.getChannelData(ch);
            for (let i = 0; i < irLen; i++) {
              const decay = Math.pow(1 - i / irLen, 2.7);
              data[i] = (Math.random() * 2 - 1) * decay;
            }
          }
          const convolver = ctx.createConvolver(); convolver.buffer = ir;
          const reverbWet = ctx.createGain(); reverbWet.gain.value = 0.18;
          convolver.connect(reverbWet); reverbWet.connect(this.master);
          this.musicRev = ctx.createGain(); this.musicRev.gain.value = this.musicOn ? 0.22 : 0; this.musicRev.connect(convolver);
          this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = this.sfxOn ? 0.32 : 0; this.sfxRev.connect(convolver);

          const len = ctx.sampleRate; this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        start(song, beatOffset = 0, vol = 0.55, tempo = 1) {
          if (!this.ctx) return;
          if (this.ctx.state === "suspended") this.ctx.resume();
          this.song = song; this.beatSec = 60 / (song.bpm * tempo); this.curVol = vol;
          const now = this.ctx.currentTime;
          this.startTime = now + 0.06 - beatOffset * this.beatSec;
          this.step = ((Math.round(beatOffset * 4) % 64) + 64) % 64;
          this.next = now + 0.06;
          this.musicBus.gain.cancelScheduledValues(now);
          this.musicBus.gain.setTargetAtTime(this.musicOn ? vol : 0.0001, now, 0.05);
          if (!this.playing) { this.playing = true; this.timer = setInterval(() => this.schedule(), 30); }
        }
        stop(fade = 0.3) {
          if (!this.ctx) return;
          this.playing = false; clearInterval(this.timer); this.timer = null;
          const now = this.ctx.currentTime;
          this.musicBus.gain.cancelScheduledValues(now); this.musicBus.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fade / 3));
        }
        setMuted(m) { this.muted = m; if (!this.ctx) return; const now = this.ctx.currentTime; this.master.gain.cancelScheduledValues(now); this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.02); }
        setMusicOn(on) { this.musicOn = on; if (!this.ctx) return; const now = this.ctx.currentTime; this.musicBus.gain.cancelScheduledValues(now); this.musicBus.gain.setTargetAtTime(on && this.playing ? this.curVol : 0.0001, now, 0.05); this.echoMusic.gain.setTargetAtTime(on ? 1 : 0, now, 0.05); this.musicRev.gain.setTargetAtTime(on ? 0.22 : 0, now, 0.05); }
        setSfxOn(on) { this.sfxOn = on; if (!this.ctx) return; const now = this.ctx.currentTime; this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0.0001, now, 0.02); this.echoSfx.gain.setTargetAtTime(on ? 1 : 0, now, 0.02); this.sfxRev.gain.setTargetAtTime(on ? 0.32 : 0, now, 0.02); }
        suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); }
        resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
        setTempo(tempo) {
          if (!this.song) return;
          this.beatSec = 60 / (this.song.bpm * tempo);
        }
        getBeat() { if (!this.ctx || !this.playing) return -1; return (this.ctx.currentTime - this.startTime) / this.beatSec; }
        pulse() { const b = this.getBeat(); if (b < 0) return 0; const f = b - Math.floor(b); return Math.pow(1 - f, 3); }

        schedule() {
          if (!this.ctx || !this.song) return;
          const now = this.ctx.currentTime;
          if (this.next < now - 0.12) this.next = now + 0.05;
          while (this.next < now + 0.16) { this.playStep(this.step, this.next); this.next += this.beatSec / 4; this.step = (this.step + 1) % 64; }
        }
        playStep(step, t) {
          const S = this.song, bar = (step >> 4) % 4, s = step & 15, ch = S.chords[bar];
          if (S.pad && s === 0) this.pad(ch, t);
          if (s === 0 || s === 8) this.chordStab(ch, t, s === 0 ? 0.042 : 0.026);
          if (S.drums) {
            const d = S.drums;
            if (d.kick.indexOf(s) !== -1) this.kick(t, d.kickVol);
            if (d.snare.indexOf(s) !== -1) this.snare(t, d.snareVol);
            if (d.hat.indexOf(s) !== -1) this.hat(t, d.open && d.open.indexOf(s) !== -1, d.hatVol);
            else if (s % 2 === 1) this.hat(t, false, 0.012);
          }
          if (S.bass) for (const b of S.bass) if (b[0] === s) this.bassNote(ch.b + b[1], t, b[2]);
          if (S.arp && s % 2 === 0) this.note(S.arpVoice || "pluck", ch.t[S.arp[(s >> 1) % S.arp.length]] + 12, t, this.beatSec * 0.5, S.arpVol || 0.04, false);
          if (S.melody) { const ms = step % 32; for (const m of S.melody) if (m[0] === ms) this.note(S.voice, m[1], t, m[2] * this.beatSec, S.melVol || 0.12, true); }
          if (s === 7 || s === 15) this.note("bell", ch.t[(bar + (s === 15 ? 1 : 0)) % 3] + 24, t, this.beatSec, 0.016, true);
        }
        env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
        osc(type, f, det = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; return o; }

        note(voice, m, t, dur, vol, echo) {
          const ctx = this.ctx, f = midi(m);
          const out = ctx.createGain(); out.gain.value = 1; out.connect(this.musicBus); out.connect(this.musicRev); if (echo) out.connect(this.echoMusic);
          let stopAt;
          if (voice === "piano") {
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.connect(out);
            const d = Math.max(0.55, dur * 1.6); stopAt = t + d + 0.05;
            for (const p of [["triangle", 1, 1, d], ["sine", 2, 0.35, d * 0.5], ["sine", 3.01, 0.12, d * 0.25]]) {
              const o = this.osc(p[0], f * p[1]); const g = ctx.createGain(); this.env(g, t, 0.005, p[3], vol * p[2]);
              o.connect(g); g.connect(lp); o.start(t); o.stop(stopAt);
            }
          } else if (voice === "marimba") {
            const o1 = this.osc("sine", f), o2 = this.osc("sine", f * 4), g1 = ctx.createGain(), g2 = ctx.createGain();
            this.env(g1, t, 0.004, 0.42, vol); this.env(g2, t, 0.002, 0.08, vol * 0.3);
            o1.connect(g1); o2.connect(g2); g1.connect(out); g2.connect(out); stopAt = t + 0.5; o1.start(t); o2.start(t); o1.stop(stopAt); o2.stop(stopAt);
          } else if (voice === "bell") {
            const d = Math.max(1.0, dur * 2); stopAt = t + d + 0.05;
            for (const p of [[1, 1], [2.76, 0.32], [5.4, 0.1]]) {
              const o = this.osc("sine", f * p[0]); const g = ctx.createGain(); this.env(g, t, 0.003, d * (p[0] > 2 ? 0.45 : 1), vol * p[1] * 0.75);
              o.connect(g); g.connect(out); o.start(t); o.stop(stopAt);
            }
          } else {
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2800, t); lp.frequency.exponentialRampToValueAtTime(480, t + 0.25); lp.connect(out);
            const o1 = this.osc("sawtooth", f, -5), o2 = this.osc("square", f, 5), g = ctx.createGain(); const d = Math.max(0.22, dur * 0.9);
            this.env(g, t, 0.003, d, vol * 0.6); o1.connect(g); o2.connect(g); g.connect(lp); stopAt = t + d + 0.03; o1.start(t); o2.start(t); o1.stop(stopAt); o2.stop(stopAt);
          }
        }

        pad(ch, t) {
          const ctx = this.ctx, lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800; lp.Q.value = 0.4;
          const g = ctx.createGain(); const bar = this.beatSec * 4;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.5); g.gain.setValueAtTime(0.045, t + bar * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 0.05);
          lp.connect(g); g.connect(this.musicBus);
          ch.t.forEach((n, i) => { const o = this.osc("triangle", midi(n), (i - 1) * 7); o.connect(lp); o.start(t); o.stop(t + bar + 0.1); });
        }
        chordStab(ch, t, vol) {
          const ctx = this.ctx, lp = ctx.createBiquadFilter();
          lp.type = "lowpass"; lp.frequency.setValueAtTime(2100, t); lp.frequency.exponentialRampToValueAtTime(520, t + 0.28);
          const out = ctx.createGain(); out.gain.value = 1; lp.connect(out); out.connect(this.musicBus); out.connect(this.musicRev);
          ch.t.forEach((n, i) => {
            const o = this.osc(i === 1 ? "triangle" : "sine", midi(n + 12), (i - 1) * 4);
            const g = ctx.createGain(); this.env(g, t, 0.008, 0.28, vol * (i === 1 ? 1 : 0.72));
            o.connect(g); g.connect(lp); o.start(t); o.stop(t + 0.32);
          });
        }
        kick(t, v = 0.45) { const ctx = this.ctx, o = this.osc("sine", 150), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.22); }
        snare(t, v = 0.16) { const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + 0.18); }
        hat(t, open, v = 0.05) { const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500; const g = ctx.createGain(); const d = open ? 0.1 : 0.035; g.gain.setValueAtTime(v * (open ? 1.3 : 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + d + 0.02); }
        bassNote(n, t, v) { const ctx = this.ctx, o = this.osc("sawtooth", midi(n)), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(680, t); f.frequency.exponentialRampToValueAtTime(170, t + 0.22); const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.3); }

        /* Sound effects synthesis */
        tapClick() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          // Dual woodblock click + subtle tone
          const s = ctx.createBufferSource(); s.buffer = this.noise;
          const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1650; f.Q.value = 3.5;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
          s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.04);
          const o = this.osc("sine", 880), og = ctx.createGain(); og.gain.setValueAtTime(0.08, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
          o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.05);
        }
        gem() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const o = this.osc("sine", 880), g = ctx.createGain();
          o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.07); o.frequency.exponentialRampToValueAtTime(2640, t + 0.15);
          g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          o.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx); g.connect(this.sfxRev); o.start(t); o.stop(t + 0.3);
        }
        crown() {
          if (!this.ctx) return; const ctx = this.ctx;
          [784, 988, 1175, 1568].forEach((f, i) => {
            const t = ctx.currentTime + i * 0.08, o = this.osc("triangle", f), g = ctx.createGain();
            this.env(g, t, 0.01, 0.42, 0.14); o.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx); g.connect(this.sfxRev); o.start(t); o.stop(t + 0.5);
          });
        }
        complete() {
          if (!this.ctx) return; const ctx = this.ctx;
          [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.noteSfx(f, ctx.currentTime + i * 0.11, 0.9, 0.14));
        }
        unlockJingle() {
          if (!this.ctx) return; const ctx = this.ctx;
          [880, 1109, 1319].forEach((f, i) => this.noteSfx(f, ctx.currentTime + i * 0.1, 0.6, 0.1));
        }
        noteSfx(f, t, d, v) {
          const ctx = this.ctx, o = this.osc("triangle", f), o2 = this.osc("sine", f * 2), g = ctx.createGain();
          this.env(g, t, 0.01, d, v); o.connect(g); o2.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx);
          o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
        }
        crash() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.4);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.5);
          const o = this.osc("sawtooth", 160), og = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(40, t + 0.4); og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.5);
        }
        fall() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.8);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.85); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.9);
          const o = this.osc("sine", 320), og = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(55, t + 0.8); og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.85);
        }
        thunder(delay = 0.5) {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + delay;
          const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.6);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 1.9);
          const o = this.osc("sine", 48), og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.18, t + 0.08); og.gain.exponentialRampToValueAtTime(0.001, t + 1.4); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 1.5);
        }
        uiClick() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, o = this.osc("sine", 960), g = ctx.createGain();
          g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.06);
        }
        deny() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          [220, 196].forEach((f, i) => { const o = this.osc("square", f), g = ctx.createGain(); const s = t + i * 0.09; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.05, s + 0.01); g.gain.exponentialRampToValueAtTime(0.001, s + 0.09); o.connect(g); g.connect(this.sfxBus); o.start(s); o.stop(s + 0.1); });
        }
      }

      /* ================================================================
         3. LEVELS — 8 Authentic Themed Levels
         ================================================================ */
      const BASE_COLORS = {
        trunk: 0x8b5a3c, leaf: 0x2f9e5b, leaf2: 0x63c46e, rock: 0xa8b6c4, accent: 0xff7bac, accent2: 0xfff275,
        snow: 0xffffff, sand: 0xf1c58f, cactus: 0x4f9d5c, pyramid: 0xd28d4d, crystal: 0x7ae7ff, crystal2: 0xc77dff,
        ice: 0x8fd8ff, key: 0xfafafa, keySide: 0xd6d6d6, keyBlack: 0x262626, guide: 0xffffff, wall: 0xffffff, gem: 0xffd23f, marker: 0xffffff,
      };
      const GROUND_Y = -2.2;

      const LEVELS = [
        {
          id: "beginning", name: "The Beginning", stars: 1, bpm: 110, upb: 2.8, guide: true, guideDots: false, birds: true, clouds: 0xffffff,
          ambient: { type: "petals", color: 0xffd1e3, size: 0.16, opacity: 0.55, count: 90 },
          colors: { sky: 0xaec8ff, horizon: 0xe9f1ff, fog: 0xdce8ff, floorTop: 0xffffff, floorSide: 0xd8e2f3, line: 0x38b9e6, wall: 0xffffff, gem: 0xffc93c, sun: 0xffffff, marker: 0xffffff },
          song: {
            bpm: 110, voice: "marimba", arpVoice: "marimba", arpVol: 0.035, pad: true, melVol: 0.11,
            chords: [{ b: 48, t: [60, 64, 67] }, { b: 43, t: [59, 62, 67] }, { b: 45, t: [57, 60, 64] }, { b: 41, t: [57, 60, 65] }],
            arp: [0, 1, 2, 1, 0, 2, 1, 2], bass: [[0, 0, 0.28], [8, 0, 0.2], [12, 7, 0.16]],
            drums: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], open: [], kickVol: 0.35, snareVol: 0.12, hatVol: 0.04 },
            melody: [[0, 72, 1], [4, 74, 1], [8, 76, 1], [12, 79, 1], [16, 76, 1], [20, 74, 1], [24, 72, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 3.2, style: "meadow", cam: 1.12 },
            { bars: 4, phrase: [2], w: 3.2, style: "meadow" },
            { bars: 4, phrase: [2, 2, 4], w: 3.0, style: "forest" },
            { bars: 4, phrase: [4, 2, 2], w: 3.0, style: "forest", walls: true },
            { bars: 4, phrase: [1, 1, 2], w: 3.0, style: "meadow" },
            { bars: 4, phrase: [2, 1, 1], w: 2.8, style: "forest", walls: true, reveal: "drop" },
            { bars: 4, phrase: [4], w: 2.8, style: "meadow", cam: 1.1 },
            { bars: 4, phrase: [2, 2, 1, 1, 2], w: 2.8, style: "forest" },
            { bars: 4, phrase: [1, 1, 1, 1, 4], w: 2.6, style: "meadow", walls: true },
            { bars: 4, phrase: [2], w: 2.6, style: "forest", reveal: "drop", cam: 1.15 },
          ],
        },
        {
          id: "piano", name: "The Piano", stars: 2, bpm: 125, upb: 3.0, clouds: 0xfff4e4,
          ambient: { type: "sparkle", color: 0xffe9b0, size: 0.12, opacity: 0.5, count: 80 },
          colors: { sky: 0xffc48f, horizon: 0xfff1e0, fog: 0xffe4c8, floorTop: 0xffd9a8, floorSide: 0xe0a068, line: 0xff7f27, wall: 0xffe7cf, gem: 0x4cc9f0, sun: 0xfff7e6, marker: 0x3a2a1a },
          song: {
            bpm: 125, voice: "piano", arpVoice: "piano", arpVol: 0.04, pad: true, melVol: 0.14,
            chords: [{ b: 48, t: [60, 63, 67] }, { b: 44, t: [56, 60, 63] }, { b: 51, t: [63, 67, 70] }, { b: 46, t: [58, 62, 65] }],
            arp: [0, 1, 2, 1, 0, 1, 2, 1], bass: [[0, 0, 0.3], [6, 0, 0.18], [8, 12, 0.22], [14, 7, 0.18]],
            drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [14], kickVol: 0.45, snareVol: 0.18, hatVol: 0.06 },
            melody: [[0, 72, 0.75], [3, 75, 0.75], [6, 79, 1], [10, 77, 0.5], [12, 75, 1], [16, 72, 0.75], [19, 70, 0.75], [22, 67, 1], [26, 70, 0.5], [28, 72, 1.5]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.8, style: "keys", cam: 1.1 },
            { bars: 4, phrase: [2], w: 2.6, style: "keys" },
            { bars: 4, phrase: [2, 1, 1], w: 2.6, style: "keys" },
            { bars: 4, phrase: [1, 1, 2], w: 2.4, style: "keys", walls: true },
            { bars: 4, phrase: [4, 1, 1, 2], w: 2.4, style: "keys" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 2.4, style: "keys", walls: true, cam: 0.94 },
            { bars: 4, phrase: [2, 2, 4], w: 2.4, style: "keys", reveal: "drop" },
            { bars: 4, phrase: [2, 1, 1], w: 2.2, style: "keys" },
            { bars: 4, phrase: [1, 1, 2], w: 2.2, style: "keys", walls: true },
            { bars: 4, phrase: [4], w: 2.2, style: "keys", cam: 1.12 },
          ],
        },
        {
          id: "savanna", name: "The Savanna", stars: 2, bpm: 118, upb: 3.0, birds: true, clouds: 0xfff2d8,
          ground: { y: GROUND_Y, color: 0xd9a441 }, sunDisc: { color: 0xffe08a, size: 14 },
          ambient: { type: "dust", color: 0xffe7b8, size: 0.13, opacity: 0.3, count: 90 },
          colors: { sky: 0xffb85c, horizon: 0xffe3a8, fog: 0xf7d391, floorTop: 0xfff0c2, floorSide: 0xdcb46a, line: 0x1e6fd9, wall: 0xf3d79a, gem: 0xff5d9e, sun: 0xffe08a, marker: 0xffffff, trunk: 0x7a4b2a, leaf: 0x5c9e4a, leaf2: 0xa8c95a, rock: 0xb08a5a, sand: 0xc98f4a },
          song: {
            bpm: 118, voice: "marimba", arpVoice: "pluck", arpVol: 0.04, pad: true, melVol: 0.11,
            chords: [{ b: 41, t: [65, 69, 72] }, { b: 36, t: [60, 64, 67] }, { b: 38, t: [62, 65, 69] }, { b: 46, t: [58, 62, 65] }],
            arp: [0, 1, 2, 1, 0, 2, 1, 2], bass: [[0, 0, 0.3], [6, 0, 0.18], [8, 7, 0.22], [12, 0, 0.2], [14, 12, 0.16]],
            drums: { kick: [0, 5, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14], open: [14], kickVol: 0.42, snareVol: 0.15, hatVol: 0.05 },
            melody: [[0, 77, 1], [4, 79, 1], [8, 81, 1.5], [12, 79, 0.5], [14, 77, 0.5], [16, 74, 1], [20, 77, 1], [24, 72, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.8, style: "savanna", cam: 1.14 },
            { bars: 4, phrase: [2], w: 2.8, style: "savanna" },
            { bars: 4, phrase: [2, 2, 1, 1], w: 2.6, style: "savanna" },
            { bars: 4, phrase: [4, 2, 2], w: 2.6, style: "savanna", walls: true },
            { bars: 4, phrase: [1, 1, 2], w: 2.6, style: "savanna" },
            { bars: 4, phrase: [2, 1, 1, 4], w: 2.4, style: "savanna", reveal: "drop" },
            { bars: 4, phrase: [1, 1, 1, 1, 2, 2], w: 2.4, style: "savanna", walls: true },
            { bars: 4, phrase: [2], w: 2.4, style: "savanna", cam: 1.1 },
            { bars: 4, phrase: [4, 1, 1, 2], w: 2.4, style: "savanna", walls: true },
            { bars: 4, phrase: [2, 2, 4], w: 2.6, style: "savanna", cam: 1.16 },
          ],
        },
        {
          id: "desert", name: "The Desert", stars: 3, bpm: 120, upb: 3.0, clouds: 0xfff3dd,
          ground: { y: GROUND_Y, color: 0xe3b278 }, sunDisc: { color: 0xffd58a, size: 11 },
          ambient: { type: "dust", color: 0xfff0d0, size: 0.14, opacity: 0.35, count: 120 },
          colors: { sky: 0xf7b267, horizon: 0xffe9c8, fog: 0xf9dcb0, floorTop: 0xffd89a, floorSide: 0xc98a4f, line: 0x1fb8a8, wall: 0xe8b77a, gem: 0x3dd6f5, rock: 0xb27a4f, sun: 0xffd9a0, marker: 0xffffff, sand: 0xf0c48a },
          song: {
            bpm: 120, voice: "pluck", arpVoice: "pluck", arpVol: 0.045, pad: true, melVol: 0.12,
            chords: [{ b: 50, t: [62, 65, 69] }, { b: 46, t: [58, 62, 65] }, { b: 48, t: [60, 64, 67] }, { b: 45, t: [57, 61, 64] }],
            arp: [0, 2, 1, 2, 0, 2, 1, 0], bass: [[0, 0, 0.3], [3, 0, 0.18], [6, 0, 0.22], [8, 0, 0.26], [11, 3, 0.16], [14, -2, 0.2]],
            drums: { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [10], kickVol: 0.4, snareVol: 0.16, hatVol: 0.045 },
            melody: [[0, 74, 0.5], [2, 77, 0.5], [4, 76, 1], [8, 74, 0.5], [10, 72, 0.5], [12, 73, 1], [16, 74, 0.5], [18, 77, 0.5], [20, 81, 1], [24, 79, 0.5], [26, 77, 0.5], [28, 76, 1]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.6, style: "desert", cam: 1.14 },
            { bars: 4, phrase: [2], w: 2.6, style: "desert" },
            { bars: 4, phrase: [2, 1, 1], w: 2.4, style: "desert" },
            { bars: 4, phrase: [1, 1, 2], w: 2.4, style: "desert", walls: true },
            { bars: 4, phrase: [1, 1, 1, 1], w: 2.4, style: "desert", reveal: "drop", cam: 0.94 },
            { bars: 4, phrase: [2, 2, 1, 1, 2], w: 2.2, style: "desert" },
            { bars: 4, phrase: [4, 2, 2], w: 2.2, style: "desert", walls: true },
            { bars: 4, phrase: [1, 1, 2], w: 2.2, style: "desert" },
            { bars: 4, phrase: [1, 1, 1, 1, 2, 2], w: 2.0, style: "desert", walls: true, cam: 0.92 },
            { bars: 4, phrase: [2], w: 2.0, style: "desert", reveal: "drop" },
            { bars: 4, phrase: [4], w: 2.2, style: "desert", cam: 1.16 },
          ],
        },
        {
          id: "autumn", name: "The Autumn", stars: 3, bpm: 112, upb: 2.9, birds: true, clouds: 0xfff2e6,
          ground: { y: GROUND_Y, color: 0xcf8a4b },
          ambient: { type: "leaves", color: 0xff9f43, size: 0.17, opacity: 0.75, count: 120 },
          colors: { sky: 0xffc7a0, horizon: 0xfff0df, fog: 0xffe2c9, floorTop: 0xfff1d6, floorSide: 0xd9b48a, line: 0xc0392b, wall: 0xf5deb3, gem: 0x4cc9f0, sun: 0xfff1d8, marker: 0xffffff, trunk: 0x6e4326, leaf: 0xe8742c, leaf2: 0xd2452c, accent: 0xff8c3a, accent2: 0xf4c542, rock: 0x9c8b7a, sand: 0xe6c27a },
          song: {
            bpm: 112, voice: "piano", arpVoice: "piano", arpVol: 0.035, pad: true, melVol: 0.13,
            chords: [{ b: 43, t: [55, 59, 62] }, { b: 40, t: [52, 55, 59] }, { b: 36, t: [60, 64, 67] }, { b: 38, t: [62, 66, 69] }],
            arp: [0, 1, 2, 1, 0, 1, 2, 1], bass: [[0, 0, 0.28], [8, 0, 0.2], [12, 7, 0.16]],
            drums: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], open: [], kickVol: 0.32, snareVol: 0.11, hatVol: 0.04 },
            melody: [[0, 74, 1], [4, 71, 1], [8, 67, 1], [12, 69, 1], [16, 71, 1.5], [20, 69, 0.5], [22, 67, 0.5], [24, 62, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.6, style: "autumn", cam: 1.12 },
            { bars: 4, phrase: [2], w: 2.6, style: "autumn" },
            { bars: 4, phrase: [2, 1, 1], w: 2.4, style: "autumn" },
            { bars: 4, phrase: [1, 1, 2], w: 2.4, style: "autumn", walls: true },
            { bars: 4, phrase: [1, 1, 1, 1], w: 2.4, style: "autumn", reveal: "drop" },
            { bars: 4, phrase: [2, 2, 1, 1, 2], w: 2.2, style: "autumn" },
            { bars: 4, phrase: [4, 1, 1, 2], w: 2.2, style: "autumn", walls: true },
            { bars: 4, phrase: [1, 1, 2, 2, 1, 1], w: 2.2, style: "autumn", cam: 0.95 },
            { bars: 4, phrase: [1, 1, 1, 1, 4], w: 2.0, style: "autumn", walls: true },
            { bars: 4, phrase: [2], w: 2.2, style: "autumn", reveal: "drop" },
            { bars: 4, phrase: [4], w: 2.4, style: "autumn", cam: 1.16 },
          ],
        },
        {
          id: "winter", name: "The Winter", stars: 4, bpm: 128, upb: 3.2, clouds: 0xffffff,
          ground: { y: GROUND_Y, color: 0xf2f8ff },
          ambient: { type: "snow", color: 0xffffff, size: 0.16, opacity: 0.85, count: 260 },
          colors: { sky: 0x9fd0ff, horizon: 0xf3f9ff, fog: 0xe4f1ff, floorTop: 0xbfe0ff, floorSide: 0x7fb0e0, line: 0x2f6fd6, wall: 0xdaeeff, gem: 0xff5d9e, trunk: 0x6b4a36, leaf: 0x2f7a5c, rock: 0x9fb0c2, sun: 0xffffff, marker: 0x2f6fd6 },
          song: {
            bpm: 128, voice: "bell", arpVoice: "pluck", arpVol: 0.04, pad: true, melVol: 0.1,
            chords: [{ b: 45, t: [57, 60, 64] }, { b: 41, t: [53, 57, 60] }, { b: 36, t: [60, 64, 67] }, { b: 43, t: [55, 59, 62] }],
            arp: [0, 1, 2, 1, 0, 2, 1, 2], bass: [[0, 0, 0.3], [6, 0, 0.2], [8, 12, 0.22], [14, 7, 0.2]],
            drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [14], kickVol: 0.45, snareVol: 0.17, hatVol: 0.06 },
            melody: [[0, 81, 1], [4, 84, 1], [8, 83, 0.5], [10, 81, 0.5], [12, 79, 1], [16, 76, 1], [20, 79, 1], [24, 81, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.4, style: "winter", cam: 1.12 },
            { bars: 4, phrase: [2], w: 2.4, style: "winter" },
            { bars: 4, phrase: [1, 1, 2], w: 2.2, style: "winter" },
            { bars: 4, phrase: [2, 1, 1], w: 2.2, style: "winter", walls: true },
            { bars: 4, phrase: [1, 1, 1, 1], w: 2.2, style: "winter", reveal: "drop", cam: 0.94 },
            { bars: 4, phrase: [1, 1, 2, 2, 1, 1], w: 2.0, style: "winter", walls: true },
            { bars: 4, phrase: [2, 2, 4], w: 2.0, style: "winter" },
            { bars: 4, phrase: [1, 1, 1, 1, 2], w: 2.0, style: "winter", reveal: "drop" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 1.9, style: "winter", walls: true, cam: 0.92 },
            { bars: 4, phrase: [2, 1, 1, 4], w: 2.0, style: "winter" },
            { bars: 4, phrase: [4], w: 2.2, style: "winter", cam: 1.16 },
          ],
        },
        {
          id: "cave", name: "The Cave", stars: 4, bpm: 122, upb: 3.1, light: 0.85, stars_: 0.6, clouds: false,
          ambient: { type: "fireflies", color: 0x9ff5ff, size: 0.14, opacity: 0.85, count: 70 },
          colors: { sky: 0x1b1f3a, horizon: 0x3a2f6b, fog: 0x2a2650, floorTop: 0x5d5a8a, floorSide: 0x3b3860, line: 0xffe66d, wall: 0x4a4675, gem: 0xff4d6d, rock: 0x55507a, sun: 0x6a5cff, marker: 0xffe66d },
          song: {
            bpm: 122, voice: "bell", arpVoice: "pluck", arpVol: 0.035, pad: true, melVol: 0.09,
            chords: [{ b: 40, t: [64, 67, 71] }, { b: 36, t: [60, 64, 67] }, { b: 38, t: [62, 66, 69] }, { b: 35, t: [59, 62, 66] }],
            arp: [0, 1, 2, 1], bass: [[0, 0, 0.32], [8, 0, 0.24], [12, 0, 0.18]],
            drums: { kick: [0, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14], open: [], kickVol: 0.5, snareVol: 0.14, hatVol: 0.035 },
            melody: [[0, 76, 1], [4, 79, 1], [8, 78, 0.5], [10, 76, 0.5], [12, 74, 1.5], [16, 71, 1], [20, 74, 1], [24, 76, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.2, style: "cave", cam: 1.08 },
            { bars: 4, phrase: [2], w: 2.2, style: "cave" },
            { bars: 4, phrase: [2, 1, 1], w: 2.0, style: "cave", walls: true },
            { bars: 4, phrase: [1, 1, 2], w: 2.0, style: "cave" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 2.0, style: "cave", walls: true, reveal: "drop", cam: 0.92 },
            { bars: 4, phrase: [2, 1, 1, 4], w: 1.9, style: "cave" },
            { bars: 4, phrase: [1, 1, 1, 1, 2, 2], w: 1.9, style: "cave", walls: true },
            { bars: 4, phrase: [2, 2, 1, 1, 2], w: 1.8, style: "cave", reveal: "drop" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 1.8, style: "cave", walls: true, cam: 0.9 },
            { bars: 4, phrase: [2], w: 1.9, style: "cave" },
            { bars: 4, phrase: [4], w: 2.1, style: "cave", cam: 1.14 },
          ],
        },
        {
          id: "storm", name: "The Storm", stars: 5, bpm: 132, upb: 3.2, light: 0.75, weather: "storm", clouds: 0x46536e,
          ground: { y: GROUND_Y, color: 0x2f3a52 },
          ambient: { type: "rain", color: 0xbfd2ff, size: 0.1, opacity: 0.45, count: 340 },
          colors: { sky: 0x1c2540, horizon: 0x54617f, fog: 0x3f4a66, floorTop: 0x8d9bb8, floorSide: 0x5a6684, line: 0xffe66d, wall: 0x6f7d9c, gem: 0x7ee8fa, trunk: 0x2b2f3d, leaf: 0x3b4a5e, rock: 0x4c566e, sun: 0x9fb2ff, marker: 0xffe66d, snow: 0x9aa7c2 },
          song: {
            bpm: 132, voice: "pluck", arpVoice: "pluck", arpVol: 0.05, pad: true, melVol: 0.12,
            chords: [{ b: 40, t: [64, 67, 71] }, { b: 36, t: [60, 64, 67] }, { b: 45, t: [57, 60, 64] }, { b: 47, t: [59, 63, 66] }],
            arp: [0, 2, 1, 2, 0, 2, 1, 0], bass: [[0, 0, 0.32], [3, 0, 0.2], [6, 0, 0.24], [8, 0, 0.28], [11, 0, 0.2], [14, -2, 0.2]],
            drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [6, 14], kickVol: 0.5, snareVol: 0.2, hatVol: 0.06 },
            melody: [[0, 76, 0.5], [2, 79, 0.5], [4, 83, 0.5], [6, 79, 0.5], [8, 81, 1], [12, 79, 0.5], [14, 76, 0.5], [16, 74, 1], [20, 76, 0.5], [22, 79, 0.5], [24, 83, 2]],
          },
          sections: [
            { bars: 4, phrase: [4], w: 2.2, style: "storm", cam: 1.1 },
            { bars: 4, phrase: [2], w: 2.2, style: "storm" },
            { bars: 4, phrase: [1, 1, 2], w: 2.0, style: "storm", walls: true },
            { bars: 4, phrase: [2, 1, 1], w: 2.0, style: "storm" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 1.9, style: "storm", walls: true, reveal: "drop", cam: 0.93 },
            { bars: 4, phrase: [1, 1, 2, 2, 1, 1], w: 1.9, style: "storm" },
            { bars: 4, phrase: [2, 2, 1, 1, 1, 1], w: 1.8, style: "storm", walls: true, cam: 0.92 },
            { bars: 4, phrase: [1, 1, 1, 1, 2], w: 1.8, style: "storm", reveal: "drop" },
            { bars: 4, phrase: [1, 1, 1, 1], w: 1.7, style: "storm", walls: true, cam: 0.9 },
            { bars: 4, phrase: [2, 1, 1, 4], w: 1.8, style: "storm" },
            { bars: 4, phrase: [1, 1, 1, 1, 1, 1, 2], w: 1.7, style: "storm", walls: true, cam: 0.9 },
            { bars: 4, phrase: [4], w: 2.0, style: "storm", cam: 1.12 },
          ],
        },
      ];

      const CROWN_PCTS = [0.2, 0.5, 0.8];
      const GEM_PCTS = [0.06, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.94];

      /* ================================================================
         4. CONSTANTS + SAVE
         ================================================================ */
      const LINE_W = 0.6, LINE_H = 0.45, FLOOR_H = 0.9, WALL_T = 0.5, WALL_H = 1.1;
      const STUB = 1.5;          // Runway start
      const REVEAL_BEATS = 5;    // Path builds ahead
      const CELL_GAP = 0.12;     // Visible seam between path cubes
      const CELL_LOOK = 14;      // Maximum cell reveal horizon
      const SPEED_MULT = 1.22;   // Line Speed Multiplier (increases line velocity and syncs music tempo)
      const PATH_WIDTH_MULT = 0.78;
      const LEAD = 2.4;          // Camera lead
      const PICK_R = 0.75;
      const SAVE_KEY = "dancingline.save.v4";

      function loadSave() {
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith("dancingline.") && k !== SAVE_KEY) {
              localStorage.removeItem(k);
            }
          }
        } catch (e) { /* ignore */ }

        let s = {};
        try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") || {}; } catch (e) { s = {}; }
        return {
          levels: s.levels || {},
          last: s.last || 0,
          skin: s.skin || "default",
          skins: s.skins || { default: true },
          totalGems: s.totalGems || 0,
          settings: Object.assign({ music: true, sfx: true, shake: true }, s.settings || {}),
        };
      }
      function storeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
      function recFor(save, id) {
        if (!save.levels[id]) save.levels[id] = { best: 0, gems: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], crowns: [0, 0, 0], done: false, kept: 0 };
        const r = save.levels[id]; if (!r.crowns) r.crowns = [0, 0, 0]; if (r.kept == null) r.kept = 0; return r;
      }
      function isUnlocked(save, i) {
        if (i <= 0) return true;
        const p = recFor(save, LEVELS[i - 1].id);
        return p.crowns[0] === 1 || p.best >= 20 || p.done;
      }

      /* ================================================================
         5. PARTICLES, AMBIENT WEATHER, BIRDS
         ================================================================ */
      class Particles {
        constructor(scene, n) {
          this.pool = []; const geo = new THREE.BoxGeometry(1, 1, 1);
          for (let i = 0; i < n; i++) {
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true })); m.visible = false; scene.add(m);
            this.pool.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, size: 0.1, g: 10, on: false });
          }
        }
        burst(pos, colors, n, o = {}) {
          const speed = o.speed || 3, up = o.up || 2, g = o.gravity || 10, spin = o.spin || 7, life = o.life || 0.6, size = o.size || 0.1, add = o.additive !== false;
          let k = 0;
          for (const p of this.pool) {
            if (p.on) continue;
            p.on = true; p.mesh.visible = true; p.mesh.position.copy(pos);
            const a = Math.random() * Math.PI * 2, r = Math.random();
            p.vel.set(Math.cos(a) * speed * (0.35 + r * 0.65), up * (0.4 + Math.random() * 0.8) + r * speed * 0.3, Math.sin(a) * speed * (0.35 + r * 0.65));
            p.spin.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
            p.max = life * (0.6 + Math.random() * 0.7); p.life = p.max; p.size = size * (0.6 + Math.random() * 0.8); p.g = g;
            const mat = p.mesh.material; mat.color.set(colors[Math.floor(Math.random() * colors.length)]);
            mat.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending; mat.depthWrite = !add; mat.opacity = 1;
            p.mesh.scale.setScalar(p.size);
            if (++k >= n) break;
          }
        }
        update(dt) {
          for (const p of this.pool) {
            if (!p.on) continue;
            p.life -= dt; if (p.life <= 0) { p.on = false; p.mesh.visible = false; continue; }
            p.vel.y -= p.g * dt; p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
            const u = p.life / p.max; p.mesh.scale.setScalar(p.size * (0.3 + 0.7 * u)); p.mesh.material.opacity = u;
          }
        }
      }

      class Ambient {
        constructor(scene, n) {
          this.n = n; this.pos = new Float32Array(n * 3); this.seed = new Float32Array(n);
          for (let i = 0; i < n; i++) this.seed[i] = Math.random() * 100;
          this.geo = new THREE.BufferGeometry(); this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
          this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true });
          this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.visible = false; scene.add(this.points);
          this.type = "none"; this.count = 0; this.yMin = -2; this.yMax = 14; this.R = 24;
        }
        set(cfg, yMin, cx, cz) {
          this.type = cfg ? cfg.type : "none"; this.points.visible = this.type !== "none"; if (this.type === "none") return;
          this.mat.color.set(cfg.color); this.mat.size = cfg.size; this.mat.opacity = cfg.opacity; this.count = Math.min(this.n, cfg.count);
          this.yMin = yMin; this.yMax = this.type === "rain" ? 20 : this.type === "fireflies" ? 6 : 14;
          this.geo.setDrawRange(0, this.count);
          for (let i = 0; i < this.count; i++) {
            this.pos[i * 3] = cx + (Math.random() - 0.5) * 2 * this.R;
            this.pos[i * 3 + 1] = this.yMin + Math.random() * (this.yMax - this.yMin);
            this.pos[i * 3 + 2] = cz + (Math.random() - 0.5) * 2 * this.R;
          }
          this.geo.attributes.position.needsUpdate = true;
        }
        update(dt, cx, cz, t) {
          if (this.type === "none") return;
          const p = this.pos, R = this.R, yMin = this.yMin, yMax = this.yMax, type = this.type, span = yMax - yMin;
          for (let i = 0; i < this.count; i++) {
            const j = i * 3, s = this.seed[i]; let vx = 0, vy = 0, vz = 0;
            if (type === "snow") { vx = Math.sin(t * 0.7 + s) * 0.5; vy = -1.3; vz = Math.cos(t * 0.5 + s) * 0.4; }
            else if (type === "rain") { vx = -1.5; vy = -24; vz = -1.5; }
            else if (type === "dust") { vx = 1.4; vy = Math.sin(t + s) * 0.3; vz = 0.6; }
            else if (type === "fireflies") { vx = Math.sin(t * 0.9 + s * 3) * 0.6; vy = Math.cos(t * 0.7 + s * 5) * 0.4; vz = Math.sin(t * 0.6 + s * 7) * 0.6; }
            else if (type === "petals" || type === "leaves") { vx = Math.sin(t * 1.3 + s) * 1.2; vy = -0.9; vz = 0.8 + Math.cos(t + s) * 0.5; }
            else if (type === "sparkle") { vx = Math.sin(t + s) * 0.2; vy = 0.5; vz = Math.cos(t * 0.8 + s) * 0.2; }
            let x = p[j] + vx * dt, y = p[j + 1] + vy * dt, z = p[j + 2] + vz * dt;
            if (x < cx - R) x += 2 * R; else if (x > cx + R) x -= 2 * R;
            if (z < cz - R) z += 2 * R; else if (z > cz + R) z -= 2 * R;
            if (y < yMin) y += span; else if (y > yMax) y -= span;
            p[j] = x; p[j + 1] = y; p[j + 2] = z;
          }
          this.geo.attributes.position.needsUpdate = true;
        }
      }

      class Birds {
        constructor(scene) {
          this.g = new THREE.Group(); this.g.visible = false; scene.add(this.g);
          const mat = new THREE.MeshBasicMaterial({ color: 0x2b2f45 }), box = new THREE.BoxGeometry(1, 1, 1); this.wings = [];
          for (let i = 0; i < 6; i++) {
            const b = new THREE.Group(); const L = new THREE.Mesh(box, mat), R = new THREE.Mesh(box, mat);
            L.scale.set(0.55, 0.05, 0.16); L.position.x = -0.28; R.scale.set(0.55, 0.05, 0.16); R.position.x = 0.28; b.add(L, R);
            b.position.set((i % 2 ? -1 : 1) * i * 0.9, -i * 0.1, -i * 1.1); this.g.add(b); this.wings.push({ L, R, ph: i * 0.7 });
          }
          this.enabled = false; this.t = 0; this.wait = 6; this.flying = false;
        }
        setEnabled(on) { this.enabled = on; this.flying = false; this.g.visible = false; this.wait = 5 + Math.random() * 6; }
        update(dt, time, cx, cz) {
          if (!this.enabled) return;
          if (!this.flying) {
            this.wait -= dt; if (this.wait > 0) return;
            this.flying = true; this.t = 0; const dir = Math.random() < 0.5 ? 1 : -1;
            this.from = { x: cx + 26 * dir, z: cz - 26 * dir }; this.to = { x: cx - 26 * dir, z: cz + 26 * dir };
            this.g.visible = true; this.g.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z); return;
          }
          this.t += dt / 9; const u = this.t;
          if (u >= 1) { this.flying = false; this.g.visible = false; this.wait = 10 + Math.random() * 10; return; }
          this.g.position.set(this.from.x + (this.to.x - this.from.x) * u, 10.5 + Math.sin(u * 6) * 0.4, this.from.z + (this.to.z - this.from.z) * u);
          for (const w of this.wings) { const a = Math.sin(time * 9 + w.ph) * 0.65; w.L.rotation.z = a; w.R.rotation.z = -a; }
        }
      }

