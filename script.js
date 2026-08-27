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

      /* ================================================================
         6. CORE GAME CLASS
         ================================================================ */
      class Game {
        constructor(container, ui) {
          this.c = container; this.ui = ui; this.audio = new MusicEngine(); this.clock = new THREE.Clock();
          this.state = "home"; this.paused = false; this.def = null; this.levelIdx = 0; this.save = loadSave(); this.settings = this.save.settings;
          this.pos = { x: 0, z: 0 }; this.camLook = new THREE.Vector3(); this.homeLook = { x: 0, z: 0 }; this.shake = 0; this.zoom = 1; this.camScale = 1; this.flash = 0; this.boltT = 6;
          this.segs = []; this.chunks = []; this.cells = []; this.trail = []; this.gems = []; this.crowns = []; this.foot = []; this.spinners = []; this.held = []; this.mats = null;
          this.shatterCubes = [];
          this.revealList = []; this.activeReveals = []; this.revealPtr = 0; this.cellPending = 0; this.behind = 0; this.lookahead = REVEAL_BEATS * 3;
          this.practice = null; this.turns = 0; this.pct = 0; this.gemsRun = 0;
          this.initThree();
          this.particles = new Particles(this.scene, 90); this.ambient = new Ambient(this.scene, 140); this.birds = new Birds(this.scene);

          container.addEventListener("pointerdown", (e) => { e.preventDefault(); this.tap(e.clientX, e.clientY); });
          window.addEventListener("keydown", (e) => {
            if (e.repeat || this.state === "home") return;
            if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); this.togglePause(); return; }
            if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "KeyW"].indexOf(e.code) !== -1) { e.preventDefault(); this.tap(); }
          });
          window.addEventListener("resize", () => this.resize());
          document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); });
          this.resize(); this.clock.start(); this.loop();
        }

        initThree() {
          const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", precision: "highp" }));
          r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); r.setSize(this.c.clientWidth, this.c.clientHeight);
          r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
          this.c.appendChild(r.domElement);
          this.perfTier = 0; this.perfAccum = 0; this.perfFrames = 0; this.perfCheckT = 0;
          this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xd6efff, 26, 70);
          this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);

          this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899bb, 1.8); this.scene.add(this.hemi);
          this.sun = new THREE.DirectionalLight(0xffffff, 2.3); this.sun.position.set(-30, 50, -12);
          this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
          const sc = this.sun.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 20; sc.far = 85;
          this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.015;
          this.scene.add(this.sun); this.scene.add(this.sun.target);
          this.fill = new THREE.DirectionalLight(0xffffff, 0.6); this.fill.position.set(30, 20, 40); this.scene.add(this.fill);
          this.world = new THREE.Group(); this.scene.add(this.world);

          this.skyU = { top: { value: new THREE.Color(0x7fc8ff) }, bottom: { value: new THREE.Color(0xe6f6ff) }, sun: { value: new THREE.Color(0xfff3c4) }, dir: { value: new THREE.Vector3(0.4, 0.25, 0.6).normalize() } };
          this.sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 14), new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU,
            vertexShader: "varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
            fragmentShader: "uniform vec3 top; uniform vec3 bottom; uniform vec3 sun; uniform vec3 dir; varying vec3 vW; void main(){ vec3 d=normalize(vW - cameraPosition); float t=smoothstep(-0.15,0.7,d.y); vec3 c=mix(bottom,top,t); c+=sun*pow(max(dot(d,dir),0.0),18.0)*0.5; gl_FragColor=vec4(c,1.0); }",
          }));
          this.scene.add(this.sky);

          const sp = new Float32Array(240 * 3);
          for (let i = 0; i < 240; i++) { const a = Math.random() * Math.PI * 2, y = 0.05 + Math.random() * 0.95, rr = Math.sqrt(1 - y * y); sp[i * 3] = Math.cos(a) * rr * 205; sp[i * 3 + 1] = y * 205; sp[i * 3 + 2] = Math.sin(a) * rr * 205; }
          const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
          this.starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
          this.sky.add(new THREE.Points(sg, this.starsMat));

          this.sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
          this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.sunDiscMat); this.sunDisc.position.copy(this.skyU.dir.value).multiplyScalar(200); this.sunDisc.lookAt(0, 0, 0); this.sky.add(this.sunDisc);

          this.groundMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
          this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.groundMat); this.ground.rotation.x = -Math.PI / 2; this.ground.visible = false; this.ground.receiveShadow = true; this.scene.add(this.ground);

          const cv = document.createElement("canvas"); cv.width = cv.height = 128;
          const g2 = cv.getContext("2d"); const gr = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
          gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.28, "rgba(255,255,255,.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
          g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
          this.haloTex = new THREE.CanvasTexture(cv);
          this.glowMat = new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
          this.glow = new THREE.Sprite(this.glowMat); this.glow.visible = false; this.scene.add(this.glow);

          const G = (this.geo = {});
          G.box = new THREE.BoxGeometry(1, 1, 1);
          G.trunk = new THREE.CylinderGeometry(0.09, 0.13, 0.5, 6);
          G.cone = new THREE.ConeGeometry(0.55, 0.9, 7);
          G.cone6 = new THREE.ConeGeometry(1, 1, 6);
          G.pyr = new THREE.ConeGeometry(1, 1.6, 4);
          G.ico = new THREE.IcosahedronGeometry(0.4, 0);
          G.dodeca = new THREE.DodecahedronGeometry(0.45, 0);
          G.sph = new THREE.SphereGeometry(1, 8, 6);
          G.cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
          G.stem = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 5);
          G.octa = new THREE.OctahedronGeometry(0.35, 0);
          G.gem = new THREE.OctahedronGeometry(0.32, 0);
          G.band = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 10);
          G.spike = new THREE.ConeGeometry(0.11, 0.3, 4);
          G.bead = new THREE.SphereGeometry(0.07, 6, 5);

          this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92 });
          this.cloudGroup = new THREE.Group(); this.scene.add(this.cloudGroup); this.cloudKids = [];
          const crng = mulberry32(1234);
          for (let i = 0; i < 6; i++) {
            const g = new THREE.Group(); const n = 3 + (i % 3);
            for (let k = 0; k < n; k++) {
              const m = new THREE.Mesh(G.sph, this.cloudMat);
              m.position.set((k - n / 2) * 1.2 + (crng() - 0.5), (crng() - 0.5) * 0.4, (crng() - 0.5) * 1.2);
              m.scale.set(1.1 + crng() * 1.1, 0.55 + crng() * 0.35, 0.9 + crng() * 0.7);
              g.add(m);
            }
            g.position.set((crng() - 0.5) * 64, 11 + crng() * 4.5, (crng() - 0.5) * 64);
            g.scale.setScalar(0.9 + crng() * 1.2);
            g.userData.v = 0.35 + crng() * 0.5;
            this.cloudGroup.add(g); this.cloudKids.push(g);
          }
        }

        resize() {
          const w = this.c.clientWidth, h = this.c.clientHeight; if (!w || !h) return;
          this.aspect = w / h; this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
          this.camScale = this.aspect < 1 ? Math.pow(1 / this.aspect, 0.55) : this.aspect > 1.9 ? 0.94 : 1;
        }

        // Watches real frame time and steps quality down (never back up) when the
        // device can't keep up, so weaker phones/laptops settle at a smooth tier
        // instead of staying locked at a framerate the GPU can't sustain.
        trackPerf(rawDt) {
          if (this.perfTier >= 3) return;
          this.perfAccum += rawDt; this.perfFrames++; this.perfCheckT += rawDt;
          if (this.perfCheckT < 2) return;
          const avgMs = (this.perfAccum / this.perfFrames) * 1000;
          this.perfCheckT = 0; this.perfAccum = 0; this.perfFrames = 0;
          if (avgMs <= 30) return; // healthy enough (~33fps+), leave quality alone
          this.perfTier++;
          if (this.perfTier === 1) {
            // Softer shadows are the most expensive per-pixel cost; drop to hard PCF first.
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
            this.sun.shadow.mapSize.set(512, 512);
            if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
          } else if (this.perfTier === 2) {
            // Still struggling: shadows off entirely.
            this.renderer.shadowMap.enabled = false;
          } else if (this.perfTier === 3) {
            // Last resort: render fewer pixels.
            this.renderer.setPixelRatio(1);
            this.resize();
          }
        }

        applyColors(def) {
          if (this.mats) for (const k in this.mats) { const m = this.mats[k]; if (m && m.dispose) m.dispose(); }
          const c = Object.assign({}, BASE_COLORS, def.colors); this.colors = c;
          const flat = (h) => new THREE.MeshLambertMaterial({ color: h, flatShading: true });
          const M = (this.mats = {});
          for (const k of ["floorTop", "floorSide", "wall", "trunk", "leaf", "leaf2", "rock", "accent", "accent2", "snow", "sand", "cactus", "pyramid", "key", "keySide", "keyBlack", "marker"]) M[k] = flat(c[k]);
          M.floorArr = [M.floorSide, M.floorSide, M.floorTop, M.floorSide, M.floorSide, M.floorSide];
          M.keyArr = [M.keySide, M.keySide, M.key, M.keySide, M.keySide, M.keySide];

          // Selected line skin override
          const curSkin = SKINS.find((s) => s.id === this.save.skin) || SKINS[0];
          const lineCol = curSkin.color != null ? curSkin.color : c.line;
          M.line = new THREE.MeshLambertMaterial({
            color: lineCol,
            emissive: curSkin.emissive != null ? curSkin.emissive : lineCol,
            emissiveIntensity: curSkin.emissiveIntensity != null ? curSkin.emissiveIntensity : 0.28,
          });

          M.gemM = new THREE.MeshPhongMaterial({ color: c.gem, emissive: c.gem, emissiveIntensity: 0.55, shininess: 80, specular: 0xffffff });
          M.crownM = new THREE.MeshPhongMaterial({ color: 0xffc83d, emissive: 0xff9a00, emissiveIntensity: 0.32, shininess: 90, specular: 0xffffff });
          M.guideM = new THREE.MeshBasicMaterial({ color: c.guide, transparent: true, opacity: 0.75 });
          M.doorM = new THREE.MeshBasicMaterial({ color: 0x14122a });
          M.crystalM = new THREE.MeshPhongMaterial({ color: c.crystal, emissive: c.crystal, emissiveIntensity: 0.45, flatShading: true, shininess: 60 });
          M.crystal2M = new THREE.MeshPhongMaterial({ color: c.crystal2, emissive: c.crystal2, emissiveIntensity: 0.45, flatShading: true, shininess: 60 });
          M.iceM = new THREE.MeshPhongMaterial({ color: c.ice, emissive: c.ice, emissiveIntensity: 0.25, flatShading: true, shininess: 90 });
          M.edge = new THREE.MeshLambertMaterial({ color: new THREE.Color(c.floorTop).lerp(WHITE, 0.42) });
          M.gateFrame = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
          const portalCol = c.line != null ? c.line : c.gem != null ? c.gem : 0x4cc9f0;
          M.portalM = new THREE.MeshPhongMaterial({
            color: portalCol,
            emissive: portalCol,
            emissiveIntensity: 0.55,
            transparent: true,
            opacity: 0.72,
            shininess: 90,
            specular: 0xffffff,
            side: THREE.DoubleSide,
          });
          M.gemHalo = new THREE.SpriteMaterial({ map: this.haloTex, color: c.gem, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
          M.crownHalo = new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffd166, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.65 });
          this.glowMat.color.set(lineCol);

          const L = def.light || 1; this.hemi.intensity = 1.8 * L; this.sun.intensity = 2.3 * L; this.fill.intensity = 0.6 * L;
          this.skyBase = { top: new THREE.Color(c.sky), bottom: new THREE.Color(c.horizon) };
          this.skyU.top.value.copy(this.skyBase.top); this.skyU.bottom.value.copy(this.skyBase.bottom); this.skyU.sun.value.set(c.sun || 0xffffff);
          this.scene.fog.color.set(c.fog); this.renderer.setClearColor(c.fog); this.hemi.groundColor.set(c.fog);
          this.groundY = def.ground ? def.ground.y : null; this.baseY = def.ground ? def.ground.y : -FLOOR_H;
          this.ground.visible = !!def.ground; if (def.ground) { this.groundMat.color.set(def.ground.color); this.ground.position.y = def.ground.y; }
          this.starsMat.opacity = def.stars_ || 0;
          if (def.sunDisc) { this.sunDiscMat.opacity = 1; this.sunDiscMat.color.set(def.sunDisc.color); this.sunDisc.scale.setScalar(def.sunDisc.size); } else this.sunDiscMat.opacity = 0;
          this.birds.setEnabled(!!def.birds);
          const cl = def.clouds; this.cloudGroup.visible = cl !== false;
          if (cl !== false) { this.cloudMat.color.set(typeof cl === "number" ? cl : 0xffffff); this.cloudMat.opacity = def.weather === "storm" ? 0.88 : 0.92; }
          this.flash = 0; this.boltT = 4 + Math.random() * 4;
        }

        clearWorld() {
          this.clearShatter();
          while (this.world.children.length) this.world.remove(this.world.children[0]);
          this.segs = []; this.chunks = []; this.cells = []; this.activeCells = []; this.trail = []; this.gems = []; this.crowns = []; this.foot = []; this.spinners = []; this.held = [];
          this.latestCheckpoint = null;
          this.revealList = []; this.activeReveals = []; this.revealPtr = 0; this.cellPending = 0; this.cellBehind = 0;
          this.head = null; this.piece = null; this.behind = 0; this.turns = 0;
        }

        loadLevel(idx, opts = {}) {
          this.levelIdx = idx; const def = (this.def = LEVELS[idx]);
          if (!opts.backdrop) { this.save.last = idx; storeSave(this.save); this.audio.stop(0.2); }
          this.clearWorld(); this.applyColors(def); this.buildLevel(def);
          this.paused = false; this.shake = 0; this.confetti = false; this.practice = opts.practice != null ? opts.practice : null;
          if (this.practice) this.placeAtPct(this.practice); else this.placeAtStart();
          this.ambient.set(def.ambient, this.groundY != null ? this.groundY : -3, this.pos.x + LEAD, this.pos.z + LEAD);
          this.snapCamera(opts.backdrop ? "home" : "ready");
          if (opts.backdrop) { this.state = "home"; return; }
          this.state = "ready";
          this.ui.levelLoaded(def, this.practice != null ? "practice" : "new", { pct: this.pct });
        }

        buildLevel(def) {
          const rng = (this.rng = mulberry32(hashStr(def.id)));
          const upb = def.upb, secs = def.sections;
          const entries = [{ beats: 4, sec: Object.assign({}, secs[0], { walls: false, runway: true }) }];
          for (const sec of secs) {
            const total = sec.bars * 4; let acc = 0, i = 0;
            while (acc < total - 1e-6) { let b = sec.phrase[i % sec.phrase.length]; if (acc + b > total) b = total - acc; entries.push({ beats: b, sec }); acc += b; i++; }
          }
          entries.push({ beats: 4, sec: Object.assign({}, secs[secs.length - 1], { walls: false, tail: true, reveal: "rise", cam: 1.25 }) });

          let x = 0, z = 0, dist = 0; const segs = (this.segs = []);
          entries.forEach((e, i) => {
            const dirIdx = i % 2; const len = e.beats * upb + (i === 0 ? STUB : 0);
            const widthScale = PATH_WIDTH_MULT;
            const s = { i, dirIdx, dir: dirIdx ? { x: 0, z: 1 } : { x: 1, z: 0 }, start: { x, z }, len, beats: e.beats, startDist: dist, w: e.sec.w * widthScale, sec: e.sec, walls: [], obstacles: [] };
            if (dirIdx) z += len; else x += len;
            s.end = { x, z }; dist += len; s.endDist = dist;
            s.aStart = dirIdx ? s.start.z : s.start.x; s.aEnd = s.aStart + len;
            segs.push(s);
          });
          this.totalDist = dist;
          segs.forEach((s, i) => {
            s.ext0 = i > 0 ? segs[i - 1].w / 2 : s.w / 2;
            s.ext1 = i === segs.length - 1 ? s.w / 2 + 3.2 : segs[i + 1].w / 2;
            if (s.dirIdx === 0) s.floor = { x0: s.aStart - s.ext0, x1: s.aEnd + s.ext1, z0: s.start.z - s.w / 2, z1: s.start.z + s.w / 2 };
            else s.floor = { x0: s.start.x - s.w / 2, x1: s.start.x + s.w / 2, z0: s.aStart - s.ext0, z1: s.aEnd + s.ext1 };
          });
          this.lookahead = REVEAL_BEATS * upb;
          this.chunks = segs.map((s) => { const g = new THREE.Group(); g.visible = true; this.world.add(g); return { seg: s, group: g, items: [], keys: [], pulse: [] }; });

          this.buildPathCells();
          this.buildPyramid();
          this.placeMarkers();
          this.placeCollectibles();
          this.chunks.forEach((c) => this.buildChunk(c, def));
          this.revealList.sort((a, b) => a.userData.rv.at - b.userData.rv.at);
          this.revealPtr = 0; this.activeReveals = [];
          void rng;
        }

        toWorld(seg, along, lat) { return seg.dirIdx === 0 ? { x: along, z: seg.start.z + lat } : { x: seg.start.x + lat, z: along }; }

        /** Travel distance at which something located at `along` on `seg` should start appearing. */
        atFor(seg, along) { return seg.startDist + clamp(along - seg.aStart, 0, seg.len) - this.lookahead; }

        aabb(seg, a0, a1, l0, l1) {
          return seg.dirIdx === 0 ? { x0: a0, x1: a1, z0: seg.start.z + l0, z1: seg.start.z + l1 } : { x0: seg.start.x + l0, x1: seg.start.x + l1, z0: a0, z1: a1 };
        }

        addItem(chunk, obj, rv) {
          rv.dur = rv.dur || 0.5; rv.depth = rv.depth == null ? 2.2 : rv.depth; rv.delay = rv.delay || 0; rv.sy = obj.scale.y;
          if (rv.at == null) rv.at = chunk.seg.startDist - this.lookahead;
          rv.t = 0; rv.on = false; rv.done = false;
          obj.userData.rv = rv; obj.visible = false; chunk.group.add(obj); chunk.items.push(obj);
          if (rv.pulse) chunk.pulse.push(obj);
          this.revealList.push(obj);
          return obj;
        }

        slab(seg, a0, a1, l0, l1, y0, y1, mat) {
          const m = new THREE.Mesh(this.geo.box, mat); const c = this.toWorld(seg, (a0 + a1) / 2, (l0 + l1) / 2);
          if (seg.dirIdx === 0) m.scale.set(a1 - a0, y1 - y0, l1 - l0); else m.scale.set(l1 - l0, y1 - y0, a1 - a0);
          m.position.set(c.x, (y0 + y1) / 2, c.z);
          m.userData.aabb = this.aabb(seg, a0, a1, l0, l1);
          return m;
        }

        /**
         * Build the road as independent raised cells: every cube owns its reveal distance and animation.
         */
        buildPathCells() {
          this.cells = [];
          for (const seg of this.segs) {
            const start = seg.aStart - seg.ext0;
            const end = seg.aEnd + seg.ext1;
            const span = end - start;
            const desired = seg.w;
            const count = Math.max(1, Math.ceil(span / desired));
            const step = span / count;
            seg.cells = [];

            for (let i = 0; i < count; i++) {
              const center = start + step * (i + 0.5);
              const wp = this.toWorld(seg, center, 0);
              const mesh = new THREE.Mesh(this.geo.box, this.mats.floorArr);
              const alongSize = Math.max(0.12, step - CELL_GAP);
              const acrossSize = Math.max(0.3, seg.w - CELL_GAP);
              const cellHeight = -this.baseY;
              if (seg.dirIdx === 0) mesh.scale.set(alongSize, cellHeight, acrossSize);
              else mesh.scale.set(acrossSize, cellHeight, alongSize);
              mesh.position.set(wp.x, this.baseY / 2, wp.z);
              mesh.receiveShadow = true;
              mesh.visible = false;
              this.world.add(mesh);

              const local = clamp(center - seg.aStart, 0, seg.len);
              const dist = seg.startDist + local;
              const cell = {
                mesh,
                dist,
                a0: start + step * i,
                a1: start + step * (i + 1),
                revealAt: dist - Math.min(CELL_LOOK, this.lookahead),
                state: 0,
                t: 0,
                targetY: this.baseY / 2,
                sy: cellHeight,
                sx: mesh.scale.x,
                sz: mesh.scale.z,
                finalSx: seg.dirIdx === 0 ? step + 0.005 : seg.w,
                finalSz: seg.dirIdx === 0 ? seg.w : step + 0.005,
              };
              this.cells.push(cell);
              seg.cells.push(cell);
            }
          }
          this.cells.sort((a, b) => a.dist - b.dist);
          this.cellPending = 0;
        }

        buildChunk(chunk, def) {
          const seg = chunk.seg, sec = seg.sec, w = seg.w, M = this.mats, rng = this.rng, bY = this.baseY;
          const from = sec.reveal === "drop" ? "above" : "below";
          if (def.guide && def.guideDots !== false) {
            for (let a = seg.aStart + 0.7; a < seg.aEnd - 0.3; a += 1.0) {
              const d = this.slab(seg, a - 0.25, a + 0.25, -0.08, 0.08, 0.0, 0.05, M.guideM);
              this.addItem(chunk, d, { at: this.atFor(seg, a), ty: d.position.y, from: "below", depth: 3.2, delay: 0.02, dur: 0.5 });
            }
          }
          if (sec.walls) {
            const t = WALL_T;
            const hasPlus = seg.aEnd - seg.ext1 > seg.aStart - seg.ext0 + 0.2;
            if (hasPlus) seg.walls.push(this.aabb(seg, seg.aStart - seg.ext0, seg.aEnd - seg.ext1, w / 2, w / 2 + t));
            seg.walls.push(this.aabb(seg, seg.aStart + seg.ext0, seg.aEnd + seg.ext1 + t, -w / 2 - t, -w / 2));
            seg.walls.push(this.aabb(seg, seg.aEnd + seg.ext1, seg.aEnd + seg.ext1 + t, -w / 2 - t, w / 2 + t));
            const cells = seg.cells, last = cells[cells.length - 1];
            for (const cell of cells) {
              const pieces = [];
              if (hasPlus) { const lo = Math.max(cell.a0, seg.aStart - seg.ext0), hi = Math.min(cell.a1, seg.aEnd - seg.ext1); if (hi - lo > 0.05) pieces.push([lo, hi, w / 2, w / 2 + t]); }
              { const lo = Math.max(cell.a0, seg.aStart + seg.ext0), hi = Math.min(cell.a1, seg.aEnd + seg.ext1); if (hi - lo > 0.05) pieces.push([lo, hi, -w / 2 - t, -w / 2]); }
              if (cell === last) pieces.push([seg.aEnd + seg.ext1, seg.aEnd + seg.ext1 + t, -w / 2 - t, w / 2 + t]);
              for (const p of pieces) {
                const m = this.slab(seg, p[0], p[1] + 0.012, p[2], p[3], bY, WALL_H, M.wall);
                m.castShadow = true; m.receiveShadow = true;
                this.addItem(chunk, m, { at: cell.revealAt, ty: m.position.y, from, depth: 2.6, delay: 0.1, dur: 0.5 });
              }
            }
          } else if (!sec.tail) {
            const b = this.slab(seg, seg.aEnd + seg.ext1 + 0.7, seg.aEnd + seg.ext1 + 1.6, -0.45, 0.45, bY, 0.9, M.wall);
            b.castShadow = true;
            seg.obstacles.push(b.userData.aabb);
            this.addItem(chunk, b, { at: this.atFor(seg, seg.aEnd + seg.ext1 + 1.1), ty: b.position.y, from, depth: 2.6, delay: 0.14, dur: 0.5 });
          }
          if (sec.style === "keys") this.buildKeys(chunk, seg);
          else if (!(def.id === "beginning" && seg.i < 3)) this.decorate(chunk, seg, from, rng);
        }

        buildKeys(chunk, seg) {
          const KEY_LEN = 4.0, STEP = 1.0, KW = 0.92, w = seg.w, M = this.mats, pat = [1, 1, 0, 1, 1, 1, 0];
          const sides = [
            { sgn: 1, lo: seg.aStart - seg.ext0 + 0.4, hi: seg.sec.tail ? seg.aEnd - 1 : seg.aEnd - seg.ext1 - KEY_LEN - 0.4 },
            { sgn: -1, lo: seg.aStart + seg.ext0 + 0.4, hi: seg.sec.tail ? seg.aEnd - 1 : seg.aEnd + seg.ext1 - 0.4 },
          ];
          if (seg.sec.walls) { sides[0].lo += WALL_T; sides[1].lo += WALL_T; }
          for (const sd of sides) {
            let n = 0;
            for (let a = sd.lo + KW / 2; a + KW / 2 <= sd.hi; a += STEP, n++) {
              const l0 = sd.sgn > 0 ? w / 2 + 0.4 : -(w / 2 + 0.4 + KEY_LEN), l1 = l0 + KEY_LEN;
              const wk = this.slab(seg, a - (KW - 0.08) / 2, a + (KW - 0.08) / 2, l0, l1, -0.3, 0, M.keyArr);
              wk.receiveShadow = true;
              const at = this.atFor(seg, a);
              this.addItem(chunk, wk, { at, ty: wk.position.y, from: "below", depth: 1.6, delay: 0.08, dur: 0.45 });
              const key = { along: a, meshes: [wk], press: 0 };
              if (pat[n % 7] && a + STEP + KW / 2 <= sd.hi) {
                const bl = KEY_LEN * 0.55, b0 = sd.sgn > 0 ? l1 - bl : l0, b1 = b0 + bl;
                const bk = this.slab(seg, a + STEP / 2 - 0.25, a + STEP / 2 + 0.25, b0, b1, 0, 0.34, M.keyBlack);
                bk.castShadow = true;
                this.addItem(chunk, bk, { at, ty: bk.position.y, from: "below", depth: 1.6, delay: 0.12, dur: 0.45 });
                key.meshes.push(bk);
              }
              chunk.keys.push(key);
            }
          }
        }

        decorate(chunk, seg, from, rng) {
          const KINDS = {
            meadow: ["tree", "tree", "bush", "bush", "flower", "flower", "flower", "rock"],
            forest: ["tree", "tree", "tree", "tree", "tree", "bush", "bush", "rock"],
            savanna: ["acacia", "acacia", "acacia", "tuft", "tuft", "tuft", "mound", "rock", "baobab"],
            desert: ["cactus", "cactus", "cactus", "rock", "rock", "dune", "spyramid"],
            autumn: ["atree", "atree", "atree", "atree", "pumpkin", "hay", "fence", "rock", "bush"],
            winter: ["pine", "pine", "pine", "pine", "snowman", "ice", "ice", "rock"],
            cave: ["crystal", "crystal", "crystal", "crystal", "stalag", "stalag", "stalag", "rock", "rock"],
            storm: ["deadtree", "deadtree", "deadtree", "rock", "rock", "rock", "stump"],
          };
          const BIG = { meadow: "windmill", forest: "bigtree", savanna: "bigbaobab", desert: "pyramid", autumn: "windmill", winter: "mountain", cave: "bigcrystal", storm: "mountain" };
          const FOOT = { tree: 0.8, pine: 0.8, bush: 0.5, flower: 0.3, rock: 0.6, cactus: 0.5, dune: 2.6, spyramid: 1.6, snowman: 0.5, ice: 0.6, crystal: 0.7, stalag: 0.5, acacia: 1.2, tuft: 0.35, mound: 0.6, baobab: 1.0, atree: 0.9, pumpkin: 0.4, hay: 0.6, fence: 0.9, deadtree: 0.6, stump: 0.4, pyramid: 6, mountain: 6.5, bigcrystal: 2.4, bigtree: 1.6, windmill: 1.6, bigbaobab: 2.4 };
          const kinds = KINDS[seg.sec.style] || KINDS.meadow; const grounded = !!this.def.ground; const dy = grounded ? this.groundY : 0;
          const count = Math.round(seg.len / 2.4) + 1;
          for (let n = 0; n < count; n++) {
            const kind = kinds[Math.floor(rng() * kinds.length)];
            const side = rng() < 0.5 ? 1 : -1;
            const along = seg.aStart - seg.ext0 + rng() * (seg.len + seg.ext0 + seg.ext1);
            const lat = side * (seg.w / 2 + 0.9 + rng() * 3.4);
            const p = this.toWorld(seg, along, lat), r = FOOT[kind];
            if (this.blocked(p.x, p.z, r, seg.i, 6)) continue;
            const obj = this.makeDeco(kind, rng); if (!grounded) this.addTile(obj, r); obj.position.set(p.x, dy, p.z);
            if (obj.userData.spin) this.spinners.push(obj.userData.spin);
            this.addItem(chunk, obj, { at: this.atFor(seg, along), ty: dy, from, depth: grounded ? 0.8 : 2.4, delay: 0.08 + rng() * 0.25, dur: 0.55, grow: true });
            this.foot.push({ x: p.x, z: p.z, r });
          }
          const big = BIG[seg.sec.style];
          if (big && seg.i % 3 === 1) {
            const side = rng() < 0.5 ? 1 : -1;
            const alongBig = seg.aStart + rng() * seg.len;
            const p = this.toWorld(seg, alongBig, side * (seg.w / 2 + 8 + rng() * 8)), r = FOOT[big];
            if (!this.blocked(p.x, p.z, r, seg.i, 14)) {
              const obj = this.makeDeco(big, rng); if (!grounded) this.addTile(obj, r); obj.position.set(p.x, dy, p.z);
              if (obj.userData.spin) this.spinners.push(obj.userData.spin);
              // Landmarks rise a little earlier so they are on the horizon before the line arrives.
              this.addItem(chunk, obj, { at: this.atFor(seg, alongBig) - 4, ty: dy, from: "below", depth: grounded ? 1.5 : 6, delay: 0.1, dur: 1.0, grow: true });
              this.foot.push({ x: p.x, z: p.z, r });
            }
          }
        }
        addTile(obj, r) { const t = new THREE.Mesh(this.geo.box, this.mats.floorArr); const s = Math.max(0.9, r * 2.1); t.scale.set(s, 0.5, s); t.position.y = -0.25; t.receiveShadow = true; obj.add(t); }

        blocked(x, z, r, si, span) {
          for (let j = Math.max(0, si - span); j <= Math.min(this.segs.length - 1, si + span); j++) {
            const s = this.segs[j], m = r + (s.sec.walls ? 0.9 : 0.4), f = s.floor;
            if (x > f.x0 - m && x < f.x1 + m && z > f.z0 - m && z < f.z1 + m) return true;
          }
          for (const f of this.foot) { const dx = f.x - x, dz = f.z - z, rr = f.r + r; if (dx * dx + dz * dz < rr * rr) return true; }
          return false;
        }

        makeDeco(kind, rng) {
          const M = this.mats, G = this.geo, g = new THREE.Group();
          const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = g, shadow = false) => {
            const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.scale.set(sx, sy, sz);
            if (shadow) o.castShadow = true;
            parent.add(o); return o;
          };
          const R = (a, b) => a + rng() * (b - a);
          switch (kind) {
            case "tree": { add(G.trunk, M.trunk, 0, 0.25, 0, 1, 1, 1, g, true); add(G.cone, M.leaf, 0, 0.95, 0, 1.1, 1.1, 1.1); add(G.cone, M.leaf2, 0, 1.55, 0, 0.82, 0.85, 0.82); add(G.cone, M.leaf, 0, 2.05, 0, 0.52, 0.6, 0.52); g.scale.setScalar(R(0.9, 1.5)); break; }
            case "bigtree": { add(G.trunk, M.trunk, 0, 0.25, 0, 1.6, 1, 1.6, g, true); add(G.cone, M.leaf, 0, 0.95, 0, 1.4, 1.2, 1.4); add(G.cone, M.leaf2, 0, 1.65, 0, 1.05, 1, 1.05); add(G.cone, M.leaf, 0, 2.25, 0, 0.7, 0.8, 0.7); g.scale.setScalar(R(2.2, 3.2)); break; }
            case "pine": { add(G.trunk, M.trunk, 0, 0.25, 0, 1, 1, 1, g, true); add(G.cone, M.leaf, 0, 0.9, 0, 1.15, 1.1, 1.15); add(G.cone, M.leaf, 0, 1.5, 0, 0.85, 0.9, 0.85); add(G.cone, M.snow, 0, 2.05, 0, 0.5, 0.6, 0.5); g.scale.setScalar(R(0.9, 1.6)); break; }
            case "bush": { const n = 1 + Math.floor(rng() * 3); for (let i = 0; i < n; i++) { const s = R(0.7, 1.3); add(G.ico, M.leaf2, (rng() - 0.5) * 0.5, 0.3 * s, (rng() - 0.5) * 0.5, s, s, s); } break; }
            case "flower": { add(G.stem, M.leaf, 0, 0.2, 0); add(G.sph, rng() < 0.5 ? M.accent : M.accent2, 0, 0.44, 0, 0.16, 0.16, 0.16); g.scale.setScalar(R(0.8, 1.3)); break; }
            case "rock": { const o = add(G.dodeca, M.rock, 0, 0.2, 0, R(0.8, 1.8), R(0.55, 1.05), R(0.8, 1.8), g, true); o.rotation.set(rng(), rng() * 3, rng()); break; }
            case "cactus": { add(G.cyl, M.cactus, 0, 0.65, 0, 0.24, 1.3, 0.24, g, true); add(G.cyl, M.cactus, 0.3, 0.72, 0, 0.36, 0.13, 0.13); add(G.cyl, M.cactus, 0.42, 0.98, 0, 0.13, 0.55, 0.13); add(G.cyl, M.cactus, -0.28, 0.55, 0, 0.32, 0.13, 0.13); add(G.cyl, M.cactus, -0.4, 0.78, 0, 0.13, 0.5, 0.13); g.scale.setScalar(R(0.8, 1.3)); break; }
            case "dune": { add(G.sph, M.sand, 0, 0, 0, R(2.2, 3.6), R(0.5, 0.8), R(1.6, 2.6)); break; }
            case "spyramid": { const s = R(1.3, 2.3); const o = add(G.pyr, M.pyramid, 0, 0.8 * s, 0, s, s, s, g, true); o.rotation.y = Math.PI / 4; break; }
            case "pyramid": { const s = R(4, 7); const o = add(G.pyr, M.pyramid, 0, 0.8 * s, 0, s, s, s, g, true); o.rotation.y = Math.PI / 4 + (rng() - 0.5) * 0.4; break; }
            case "snowman": { add(G.sph, M.snow, 0, 0.32, 0, 0.36, 0.36, 0.36, g, true); add(G.sph, M.snow, 0, 0.82, 0, 0.27, 0.27, 0.27); add(G.sph, M.snow, 0, 1.18, 0, 0.19, 0.19, 0.19); const nose = add(G.cone, M.accent, 0, 1.18, 0.22, 0.12, 0.3, 0.12); nose.rotation.x = Math.PI / 2; break; }
            case "ice": { const n = 2 + Math.floor(rng() * 2); for (let i = 0; i < n; i++) { const o = add(G.octa, M.iceM, (rng() - 0.5) * 0.6, R(0.3, 0.6), (rng() - 0.5) * 0.6, R(0.5, 0.9), R(1.2, 2.2), R(0.5, 0.9)); o.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5); } break; }
            case "crystal": { const n = 2 + Math.floor(rng() * 3); for (let i = 0; i < n; i++) { const o = add(G.octa, rng() < 0.6 ? M.crystalM : M.crystal2M, (rng() - 0.5) * 0.7, R(0.4, 0.8), (rng() - 0.5) * 0.7, R(0.5, 0.9), R(1.6, 2.8), R(0.5, 0.9)); o.rotation.set((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6); } break; }
            case "bigcrystal": { for (let i = 0; i < 3; i++) { const o = add(G.octa, i ? M.crystal2M : M.crystalM, (rng() - 0.5) * 1.6, R(1.5, 2.6), (rng() - 0.5) * 1.6, R(1.6, 2.6), R(5, 8), R(1.6, 2.6), g, true); o.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5); } break; }
            case "stalag": { add(G.cone, M.rock, 0, 0.55, 0, R(0.4, 0.7), R(1.0, 1.8), R(0.4, 0.7), g, true); if (rng() < 0.5) add(G.cone, M.rock, 0.45, 0.35, 0.1, 0.35, 0.8, 0.35); break; }
            case "mountain": { const s = R(4, 7.5); add(G.cone6, M.rock, 0, s * 0.5, 0, s * 0.85, s, s * 0.85, g, true); add(G.cone6, M.snow, 0, s * 0.79, 0, s * 0.37, s * 0.44, s * 0.37); break; }
            case "acacia": { add(G.cyl, M.trunk, 0, 0.8, 0, 0.12, 1.6, 0.12, g, true); add(G.cyl, M.leaf, 0, 1.7, 0, 1.5, 0.32, 1.5); add(G.cyl, M.leaf2, 0.35, 1.95, 0.1, 1.0, 0.25, 1.0); g.scale.setScalar(R(0.9, 1.3)); break; }
            case "baobab": case "bigbaobab": { add(G.cyl, M.trunk, 0, 0.85, 0, 0.5, 1.7, 0.5, g, true); add(G.sph, M.leaf, 0, 1.95, 0, 0.5, 0.4, 0.5); add(G.sph, M.leaf2, 0.45, 1.85, 0.2, 0.35, 0.3, 0.35); add(G.sph, M.leaf, -0.4, 1.9, -0.25, 0.38, 0.32, 0.38); g.scale.setScalar(kind === "baobab" ? R(0.9, 1.2) : R(2.2, 2.8)); break; }
            case "tuft": { for (let i = 0; i < 4; i++) { const o = add(G.cone, M.leaf2, (rng() - 0.5) * 0.3, 0.25, (rng() - 0.5) * 0.3, 0.12, 0.55, 0.12); o.rotation.set((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5); } break; }
            case "mound": { add(G.cone, M.sand, 0, 0.5, 0, 0.5, 1.1, 0.5); add(G.cone, M.sand, 0.35, 0.3, 0.1, 0.3, 0.7, 0.3); break; }
            case "atree": { add(G.trunk, M.trunk, 0, 0.25, 0, 1, 1.3, 1, g, true); const cols = [M.leaf, M.leaf2, M.accent2]; for (let i = 0; i < 3; i++) { const s = R(0.9, 1.3); add(G.ico, cols[(i + Math.floor(rng() * 3)) % 3], (rng() - 0.5) * 0.5, 1.05 + i * 0.3, (rng() - 0.5) * 0.5, s, s, s); } g.scale.setScalar(R(0.9, 1.4)); break; }
            case "pumpkin": { add(G.sph, M.accent, 0, 0.34, 0, 0.5, 0.36, 0.5); add(G.cyl, M.leaf, 0, 0.75, 0, 0.05, 0.15, 0.05); break; }
            case "hay": { add(G.cyl, M.sand, 0, 0.3, 0, 0.55, 0.6, 0.55); break; }
            case "fence": { add(G.box, M.trunk, -0.7, 0.45, 0, 0.1, 0.9, 0.1); add(G.box, M.trunk, 0.7, 0.45, 0, 0.1, 0.9, 0.1); add(G.box, M.trunk, 0, 0.35, 0, 1.6, 0.08, 0.06); add(G.box, M.trunk, 0, 0.7, 0, 1.6, 0.08, 0.06); break; }
            case "deadtree": { add(G.cyl, M.trunk, 0, 0.9, 0, 0.13, 1.8, 0.13, g, true); for (let i = 0; i < 3; i++) { const b = add(G.cyl, M.trunk, 0, 1.3 + i * 0.22, 0, 0.06, 0.9, 0.06); b.rotation.z = (i % 2 ? 1 : -1) * R(0.5, 0.9); b.rotation.y = rng() * 3; } g.scale.setScalar(R(0.9, 1.5)); break; }
            case "stump": { add(G.cyl, M.trunk, 0, 0.2, 0, 0.3, 0.4, 0.3); break; }
            case "windmill": {
              add(G.cone6, M.wall, 0, 1.6, 0, 0.9, 3.2, 0.9, g, true); add(G.sph, M.trunk, 0, 3.3, 0, 0.6, 0.5, 0.6);
              const blades = new THREE.Group(); blades.position.set(0, 3.2, 0.75);
              add(G.box, M.trunk, 0, 0, 0, 0.16, 2.8, 0.06, blades); add(G.box, M.trunk, 0, 0, 0, 2.8, 0.16, 0.06, blades); add(G.sph, M.trunk, 0, 0, 0, 0.16, 0.16, 0.16, blades);
              g.add(blades); g.userData.spin = blades; g.scale.setScalar(R(1.2, 1.6)); break;
            }
          }
          g.rotation.y = rng() * Math.PI * 2;
          return g;
        }

        buildPyramid() {
          const seg = this.segs[this.segs.length - 1], M = this.mats, chunk = this.chunks[this.chunks.length - 1];
          const at = seg.startDist - this.lookahead;
          const aCenter = seg.aEnd + 1.6;
          const gateThick = 0.52;
          const a0 = aCenter - gateThick / 2, a1 = aCenter + gateThick / 2;
          const halfW = seg.w / 2 + 0.65;
          const pillarW = 0.44;
          const gateH = 3.6;
          const lintelH = 0.48;
          const frameMat = M.gateFrame || M.wall;

          // 1. Left Pillar
          const leftPillar = this.slab(seg, a0, a1, halfW - pillarW, halfW, 0, gateH, frameMat);
          leftPillar.castShadow = true;
          this.addItem(chunk, leftPillar, { at, ty: leftPillar.position.y, from: "below", depth: 4.5, delay: 0.1, dur: 0.8 });

          // 2. Right Pillar
          const rightPillar = this.slab(seg, a0, a1, -halfW, -(halfW - pillarW), 0, gateH, frameMat);
          rightPillar.castShadow = true;
          this.addItem(chunk, rightPillar, { at, ty: rightPillar.position.y, from: "below", depth: 4.5, delay: 0.1, dur: 0.8 });

          // 3. Top Lintel Arch Beam
          const topLintel = this.slab(seg, a0, a1, -halfW, halfW, gateH - lintelH, gateH, frameMat);
          topLintel.castShadow = true;
          this.addItem(chunk, topLintel, { at, ty: topLintel.position.y, from: "below", depth: 4.5, delay: 0.15, dur: 0.8 });

          // 4. Center Translucent Portal Glass (theme colored)
          const portalGlass = this.slab(seg, aCenter - 0.06, aCenter + 0.06, -(halfW - pillarW), halfW - pillarW, 0, gateH - lintelH, M.portalM);
          this.addItem(chunk, portalGlass, { at, ty: portalGlass.position.y, from: "below", depth: 4.5, delay: 0.2, dur: 0.8 });

          // 5. Extended finish platform under and behind portal
          const endFloor = this.slab(seg, seg.aEnd - 0.1, seg.aEnd + 3.2, -halfW - 0.2, halfW + 0.2, this.baseY, 0, M.floorArr);
          endFloor.receiveShadow = true;
          this.addItem(chunk, endFloor, { at, ty: endFloor.position.y, from: "below", depth: 2.5, delay: 0.05, dur: 0.6 });

          const c = this.toWorld(seg, aCenter, 0);
          this.foot.push({ x: c.x, z: c.z, r: halfW + 1.2 });
          this.finishPos = c;
        }

        segAt(d) { const s = this.segs; for (let i = 0; i < s.length; i++) if (d < s[i].endDist) return s[i]; return s[s.length - 1]; }

        placeMarkers() {
          const total = this.totalDist, grounded = !!this.def.ground;
          for (let p = 10; p <= 90; p += 10) {
            const seg = this.segAt((p / 100) * total);
            const along = clamp((p / 100) * total - seg.startDist, 0.5, seg.len - 0.5) + seg.aStart;
            const { geo, w, h } = textGeometry(p + "%", 0.26, 0.14); const r = Math.max(w, h) / 2 + 0.9;
            const clear = seg.sec.style === "keys" ? 5.0 : 2.4;
            const base = seg.w / 2 + clear + r * 0.7, cands = [];
            for (const extra of [0, 2, 4]) for (const da of [0, -1.5, 1.5]) for (const side of [-1, 1]) cands.push({ lat: side * (base + extra), along: clamp(along + da, seg.aStart + 0.4, seg.aEnd - 0.4) });
            let placed = false;
            for (const cand of cands) {
              const wp = this.toWorld(seg, cand.along, cand.lat); if (this.blocked(wp.x, wp.z, r, seg.i, 6)) continue;
              const g = new THREE.Group(); g.quaternion.copy(MARKER_Q); g.userData.marker = p;
              g.add(new THREE.Mesh(geo, this.mats.marker));
              if (!grounded) { const plate = new THREE.Mesh(this.geo.box, this.mats.floorArr); plate.scale.set(w + 1.2, h + 1.2, 0.36); plate.position.z = -0.25; g.add(plate); }
              const y = (grounded ? this.groundY : 0) + 0.09; g.position.set(wp.x, y, wp.z);
              this.addItem(this.chunks[seg.i], g, { at: this.atFor(seg, cand.along), ty: y, from: "below", depth: 2.4, delay: 0.25, dur: 0.6 });
              this.foot.push({ x: wp.x, z: wp.z, r }); placed = true; break;
            }
            if (!placed) geo.dispose();
          }
        }

        placeCollectibles() {
          const M = this.mats, G = this.geo, total = this.totalDist;
          GEM_PCTS.forEach((p, idx) => {
            const seg = this.segAt(p * total);
            const along = clamp(p * total - seg.startDist, 0.9, seg.len - 0.9) + seg.aStart;
            const lat = (idx === 3 || idx === 7) && seg.w >= 2.4 ? (idx === 3 ? 1 : -1) * (seg.w / 2 - 0.35) : 0;
            const wp = this.toWorld(seg, along, lat);
            const mesh = new THREE.Mesh(G.gem, M.gemM); mesh.position.set(wp.x, 0.9, wp.z);
            const halo = new THREE.Sprite(M.gemHalo); halo.scale.setScalar(1.5); mesh.add(halo);
            // Appears after its road cube has formed (cube pop = 0.62s).
            this.addItem(this.chunks[seg.i], mesh, { at: this.atFor(seg, along), ty: 0.9, from: "below", depth: 1.6, delay: 0.5, dur: 0.5 });
            this.gems.push({ mesh, halo, x: wp.x, z: wp.z, dist: seg.startDist + along - seg.aStart, idx, state: 0, t: 0, phase: idx * 1.3, chunk: this.chunks[seg.i] });
          });
          CROWN_PCTS.forEach((p, idx) => {
            let seg = this.segAt(p * total);
            while (seg.beats < 2 && seg.i < this.segs.length - 2) seg = this.segs[seg.i + 1];
            const safeOffset = clamp(seg.len * 0.35, 1.8, Math.max(1.8, seg.len - 2.8));
            const along = seg.aStart + safeOffset;
            const wp = this.toWorld(seg, along, 0);
            const g = new THREE.Group();
            g.add(new THREE.Mesh(G.band, M.crownM));
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const sp = new THREE.Mesh(G.spike, M.crownM); sp.position.set(Math.cos(a) * 0.36, 0.24, Math.sin(a) * 0.36); g.add(sp); const bd = new THREE.Mesh(G.bead, M.gemM); bd.position.set(Math.cos(a) * 0.36, 0.42, Math.sin(a) * 0.36); g.add(bd); }
            const halo = new THREE.Sprite(M.crownHalo); halo.scale.setScalar(2.3); halo.position.y = 0.2; g.add(halo);
            g.position.set(wp.x, 1.05, wp.z);
            this.addItem(this.chunks[seg.i], g, { at: this.atFor(seg, along), ty: 1.05, from: "below", depth: 1.8, delay: 0.55, dur: 0.55 });
            const crownObj = { mesh: g, halo, seg, along, dist: seg.startDist + (along - seg.aStart), idx, state: 0, used: false, t: 0, chunk: this.chunks[seg.i], pos: wp, cp: null };
            g.userData.crown = crownObj;
            this.crowns.push(crownObj);
          });
        }

        newBox() { const m = new THREE.Mesh(this.geo.box, this.mats.line); m.castShadow = true; this.world.add(m); this.trail.push(m); return m; }
        fullBox(j) {
          const s = this.segs[j], d = s.dir, a0 = j ? LINE_W / 2 : 0, len = s.len - a0 + LINE_W / 2, m = this.newBox();
          const ax = s.start.x + d.x * a0, az = s.start.z + d.z * a0;
          if (s.dirIdx === 0) { m.scale.set(len, LINE_H, LINE_W); m.position.set(ax + len / 2, LINE_H / 2, az); } else { m.scale.set(LINE_W, LINE_H, len); m.position.set(ax, LINE_H / 2, az + len / 2); }
        }
        updateHeadBox() {
          const s = this.segs[this.k], d = s.dir, m = this.head; if (!m) return;
          const bx = this.pos.x + d.x * (LINE_W / 2), bz = this.pos.z + d.z * (LINE_W / 2);
          let len = (bx - this.boxA.x) * d.x + (bz - this.boxA.z) * d.z; if (len < 0.02) len = 0.02;
          if (s.dirIdx === 0) { m.scale.set(len, LINE_H, LINE_W); m.position.set(this.boxA.x + len / 2, LINE_H / 2, this.boxA.z); } else { m.scale.set(LINE_W, LINE_H, len); m.position.set(this.boxA.x, LINE_H / 2, this.boxA.z + len / 2); }
        }
        rebuildTrail(k, pos) {
          this.clearShatter();
          for (const m of this.trail) this.world.remove(m); this.trail = [];
          if (this.piece) { this.world.remove(this.piece.pivot); this.piece = null; }
          for (let j = 0; j < k; j++) this.fullBox(j);
          const s = this.segs[k], a0 = k ? LINE_W / 2 : 0;
          this.k = k; this.pos = { x: pos.x, z: pos.z };
          this.boxA = { x: s.start.x + s.dir.x * a0, z: s.start.z + s.dir.z * a0 };
          this.head = this.newBox(); this.updateHeadBox();
          this.traveled = s.startDist + (pos.x - s.start.x) * s.dir.x + (pos.z - s.start.z) * s.dir.z;
        }

        restoreItem(it) { it.state = 0; it.t = 0; it.used = false; it.cp = null; it.mesh.scale.setScalar(1); it.mesh.visible = false; }
        placeAtStart() {
          const s = this.segs[0]; this.rebuildTrail(0, { x: s.start.x + STUB, z: s.start.z });
          for (const g of this.gems) this.restoreItem(g); for (const c of this.crowns) this.restoreItem(c);
          this.held = []; this.syncItems(true); this.syncCells(true); this.gemsRun = 0; this.pct = 0;
        }
        placeAtPct(pct) {
          let seg = this.segAt((pct / 100) * this.totalDist);
          while (seg.beats < 2 && seg.i < this.segs.length - 2) seg = this.segs[seg.i + 1];
          const safeOffset = clamp(seg.len * 0.35, 1.8, Math.max(1.8, seg.len - 2.8));
          const along = seg.aStart + safeOffset;
          const wp = this.toWorld(seg, along, 0);
          this.rebuildTrail(seg.i, wp);
          for (const g of this.gems) this.restoreItem(g); for (const c of this.crowns) this.restoreItem(c);
          this.held = []; this.syncItems(false); this.syncCells(false); this.gemsRun = 0; this.pct = clamp(Math.floor((this.traveled / this.totalDist) * 100), 0, 100);
        }

        /**
         * Restore scenery for the current position. Pieces that should already
         * exist are shown instantly (checkpoint / practice) or assembled with a
         * quick stagger (level start).
         */
        syncItems(animateOpening) {
          this.activeReveals = [];
          let n = 0;
          for (const it of this.revealList) {
            const rv = it.userData.rv;
            rv.on = false; rv.t = 0;
            if (rv.at <= this.traveled) {
              if (animateOpening) { rv.done = false; rv.on = true; rv.t = -0.15 - n * 0.03; it.visible = false; n++; this.activeReveals.push(it); }
              else { rv.done = true; it.visible = true; it.position.y = rv.ty; it.scale.y = rv.sy; }
            } else { rv.done = false; it.visible = false; }
          }
          this.revealPtr = this.revealList.findIndex((it) => it.userData.rv.at > this.traveled);
          if (this.revealPtr < 0) this.revealPtr = this.revealList.length;
          this.behind = 0;
          for (const c of this.chunks) c.group.visible = c.seg.endDist >= this.traveled - 34;
          while (this.behind < this.chunks.length && this.chunks[this.behind].seg.endDist < this.traveled - 34) this.behind++;
          for (const g of this.gems) if (g.state === 1) g.mesh.visible = false;
          for (const c of this.crowns) if (c.state === 1) c.mesh.visible = false;
        }

        /** Restore the cell road around a start/checkpoint position. */
        syncCells(animateOpening) {
          let opening = 0;
          this.cellPending = this.cells.length;
          this.cellBehind = 0;
          this.activeCells = [];
          for (let i = 0; i < this.cells.length; i++) {
            const c = this.cells[i];
            if (c.dist < this.traveled - 36) {
              c.state = 3; c.mesh.visible = false;
              this.cellBehind = i + 1;
            } else if (c.revealAt <= this.traveled) {
              if (animateOpening) {
                c.state = 1; c.t = -opening * 0.085; c.mesh.visible = false; opening++;
                this.activeCells.push(c);
              } else {
                c.state = 2; c.t = 0; c.mesh.visible = true;
                c.mesh.position.y = c.targetY;
                c.mesh.scale.set(c.finalSx, c.sy, c.finalSz);
              }
            } else {
              c.state = 0; c.t = 0; c.mesh.visible = false;
              if (this.cellPending === this.cells.length) this.cellPending = i;
            }
          }
        }

        snapCamera(mode) {
          this.homeLook = { x: this.pos.x + LEAD, z: this.pos.z + LEAD };
          this.camLook.set(this.homeLook.x, 0, this.homeLook.z);
          this.zoom = mode === "home" ? 1.08 : (this.segs[this.k] && this.segs[this.k].sec.cam) || 1;
        }

        tap(x, y) {
          if (this.paused) { this.resume(); return; }
          if (this.state === "ready") { this.startRun(); if (x !== undefined) this.ui.ripple(x, y); }
          else if (this.state === "playing") { this.turn(); if (x !== undefined) this.ui.ripple(x, y); }
        }
        getSpeedMult() {
          // Progress directly tied to completion percentage (0.0 to 1.0)
          const p = this.totalDist > 0 ? clamp(this.traveled / this.totalDist, 0, 1) : 0;
          // Manageable early pace (1.15x) -> builds steadily -> same hyper-fast climax for final stages (2.0x - 2.20x)
          return 1.15 + Math.pow(p, 1.7) * 1.05;
        }
        startRun() {
          this.audio.unlock();
          this.finishOpening();
          const tempo = this.getSpeedMult();
          this.audio.start(this.def.song, (this.traveled - STUB) / this.def.upb, 0.55, tempo);
          this.state = "playing"; this.ui.runStarted();
        }
        /**
         * If the player taps while the opening road is still assembling, snap the
         * cubes the line will reach before their animation ends; farther cubes
         * keep animating naturally.
         */
        finishOpening() {
          const speed = (this.def.upb * this.def.bpm * this.getSpeedMult()) / 60;
          for (const c of this.cells) {
            if (c.state !== 1) continue;
            const eta = (c.dist - (c.a1 - c.a0) / 2 - this.traveled) / speed, remaining = 0.62 - c.t;
            if (eta < remaining + 0.08) { c.state = 2; c.mesh.visible = true; c.mesh.position.y = c.targetY; c.mesh.scale.set(c.finalSx, c.sy, c.finalSz); }
          }
        }
        turn() {
          if (this.k >= this.segs.length - 1) return;
          this.updateHeadBox();
          this.k++; const ns = this.segs[this.k];
          this.boxA = { x: this.pos.x + ns.dir.x * (LINE_W / 2), z: this.pos.z + ns.dir.z * (LINE_W / 2) };
          this.head = this.newBox(); this.updateHeadBox();
          this.turns++; this.ui.showTapNow(false); this.audio.tapClick();
        }
        /** Re-apply the selected line skin (menu backdrop rebuilds so the change is visible at once). */
        refreshSkin() {
          if (!this.def) return;
          if (this.state === "home") this.loadLevel(this.levelIdx, { backdrop: true });
          else {
            this.applyColors(this.def);
            for (const m of this.trail) m.material = this.mats.line;
          }
        }
        togglePause() { if (this.state !== "playing") return; if (this.paused) this.resume(); else this.pause(); }
        pause() { if (this.state !== "playing" || this.paused) return; this.paused = true; this.audio.suspend(); this.ui.showPause(true); }
        resume() { if (!this.paused) return; this.paused = false; this.audio.resume(); this.clock.getDelta(); this.ui.showPause(false); }
        restart() { this.audio.uiClick(); this.loadLevel(this.levelIdx, { practice: this.practice }); }
        goHome() {
          this.audio.stop(0.3); this.paused = false;
          if (this.def) { this.placeAtStart(); this.state = "home"; this.snapCamera("home"); this.ambient.set(this.def.ambient, this.groundY != null ? this.groundY : -3, this.camLook.x, this.camLook.z); }
          this.ui.showHome();
        }

        revive() {
          const c = this.held.pop();
          if (!c || !c.cp) return this.restart();
          c.used = true;
          this.audio.uiClick();
          this.audio.stop(0.1);
          const cp = c.cp;
          this.rebuildTrail(cp.k, cp.pos);
          for (const g of this.gems) if (g.dist > cp.traveled - 0.5) this.restoreItem(g);
          this.gemsRun = this.gems.filter((g) => g.state === 1).length;
          this.syncItems(false);
          this.syncCells(false);
          this.pct = clamp(Math.floor((this.traveled / this.totalDist) * 100), 0, 100);
          this.state = "ready";
          this.shake = 0;
          this.snapCamera("ready");
          this.ui.levelLoaded(this.def, "continue", { pct: this.pct, left: this.held.length });
          this.ui.setPct(this.pct);
          this.ui.setGems(this.gemsRun);
          this.crowns.forEach((cr) => this.ui.setCrown(cr.idx, cr.used ? "used" : cr.state === 1 ? "got" : "none", false));
        }

        clearShatter() {
          if (this.shatterCubes && this.shatterCubes.length) {
            for (const c of this.shatterCubes) {
              if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
            }
            this.shatterCubes = [];
          }
        }

        shatterTrail(kind) {
          this.clearShatter();
          // Ensure head box is up to date with exact crash position
          this.updateHeadBox();

          const cubes = [];
          const cMat = this.mats.line;
          const boxGeo = this.geo.box;
          const isCrash = (kind === "crash");
          const s = this.segs[this.k];
          const curDir = s ? s.dir : { x: 1, z: 0 };

          // Iterate through every active mesh in this.trail (all past segments + current head)
          for (let ti = 0; ti < this.trail.length; ti++) {
            const m = this.trail[ti];
            if (!m || !m.visible) continue;

            const lenX = m.scale.x;
            const lenZ = m.scale.z;
            const isX = (lenX >= lenZ);
            const mainLen = isX ? lenX : lenZ;
            const step = 0.42;
            const count = Math.max(1, Math.round(mainLen / step));
            const actualStep = mainLen / count;

            for (let i = 0; i < count; i++) {
              const offset = (i + 0.5) * actualStep - mainLen / 2;
              const latOffsets = count > 1 ? [-LINE_W * 0.22, LINE_W * 0.22] : [0];

              for (const lat of latOffsets) {
                let px = m.position.x;
                let pz = m.position.z;
                if (isX) {
                  px += offset;
                  pz += lat + (Math.random() - 0.5) * 0.06;
                } else {
                  pz += offset;
                  px += lat + (Math.random() - 0.5) * 0.06;
                }

                const mesh = new THREE.Mesh(boxGeo, cMat);
                const sz = 0.32 + Math.random() * 0.12;
                mesh.scale.set(sz, sz, sz);
                mesh.position.set(px, sz / 2 + 0.04 + Math.random() * 0.04, pz);
                mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.world.add(mesh);

                const distToHead = Math.hypot(px - this.pos.x, pz - this.pos.z);
                const headProx = Math.max(0, 1 - distToHead / 14);

                const angle = Math.random() * Math.PI * 2;
                const horizSpeed = isCrash
                  ? (1.6 + Math.random() * 3.2 + headProx * 4.8)
                  : (1.2 + Math.random() * 2.2 + headProx * 2.2);
                const upSpeed = isCrash
                  ? (3.0 + Math.random() * 4.2 + headProx * 3.8)
                  : (2.2 + Math.random() * 3.2);

                cubes.push({
                  mesh,
                  size: sz,
                  fellOff: false,
                  vel: new THREE.Vector3(
                    Math.cos(angle) * horizSpeed + (curDir.x * (isCrash ? -1.0 : 0.6)),
                    upSpeed,
                    Math.sin(angle) * horizSpeed + (curDir.z * (isCrash ? -1.0 : 0.6))
                  ),
                  rot: new THREE.Vector3(
                    (Math.random() - 0.5) * 16,
                    (Math.random() - 0.5) * 16,
                    (Math.random() - 0.5) * 16
                  ),
                });
              }
            }
          }

          // Also spawn extra impact burst cubes right at the front head tip
          for (let b = 0; b < 6; b++) {
            const mesh = new THREE.Mesh(boxGeo, cMat);
            const sz = 0.32 + Math.random() * 0.14;
            mesh.scale.set(sz, sz, sz);
            mesh.position.set(
              this.pos.x + curDir.x * (LINE_W / 2) + (Math.random() - 0.5) * 0.2,
              LINE_H / 2 + (Math.random() - 0.5) * 0.1,
              this.pos.z + curDir.z * (LINE_W / 2) + (Math.random() - 0.5) * 0.2
            );
            mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.world.add(mesh);

            const angle = Math.random() * Math.PI * 2;
            const horizSpeed = 2.5 + Math.random() * 4.5;
            const upSpeed = 3.5 + Math.random() * 5.0;

            cubes.push({
              mesh,
              size: sz,
              vel: new THREE.Vector3(
                Math.cos(angle) * horizSpeed - curDir.x * 2.0,
                upSpeed,
                Math.sin(angle) * horizSpeed - curDir.z * 2.0
              ),
              rot: new THREE.Vector3(
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20
              ),
            });
          }

          // Hide all solid trail meshes now that they are replaced with cubes
          for (const m of this.trail) m.visible = false;
          if (this.head) this.head.visible = false;

          this.shatterCubes = cubes;
        }

        die(kind) {
          if (this.state !== "playing") return;
          this.state = "dead"; this.deadT = 0; this.deadKind = kind; this.ui.showTapNow(false);
          this.audio.stop(0.15);
          const rec = recFor(this.save, this.def.id); this.newBest = false;
          if (this.practice == null && this.pct > rec.best) { rec.best = this.pct; this.newBest = true; storeSave(this.save); }
          const s = this.segs[this.k], d = s.dir, c = this.colors;
          if (kind === "fall") {
            this.audio.fall();
          } else {
            this.audio.crash(); if (this.settings.shake) this.shake = 0.55; this.ui.flash();
            this.particles.burst(new THREE.Vector3(this.pos.x + d.x * 0.3, 0.4, this.pos.z + d.z * 0.3), [c.line, c.wall, 0xffffff], 24, { speed: 5.2, up: 3.4, gravity: 14, life: 0.9, size: 0.14, additive: false });
          }
          this.shatterTrail(kind);
        }

        finish() {
          if (this.state !== "playing") return;
          this.state = "finishing"; this.finT = 0; this.confetti = false; this.pct = 100; this.ui.setPct(100); this.ui.showTapNow(false);
          if (this.practice == null) {
            const rec = recFor(this.save, this.def.id); rec.best = 100; rec.done = true; rec.kept = Math.max(rec.kept, this.held.length);
            storeSave(this.save);
          }
          this.audio.complete();
        }

        loop() {
          requestAnimationFrame(() => this.loop());
          const rawDt = Math.min(this.clock.getDelta(), 0.04);
          const dt = rawDt, time = this.clock.elapsedTime;
          this.trackPerf(rawDt);
          if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
          if (this.def) {
            if (this.state === "playing") this.updatePlaying(dt);
            else if (this.state === "dead") this.updateDead(dt);
            else if (this.state === "finishing") this.updateFinishing(dt);
            this.updateCellReveals(dt); this.updateReveals(dt); this.updateCollectibles(dt, time); this.updateKeys(dt); this.updatePulse();
            for (const s of this.spinners) s.rotation.z += dt * 1.2;
            this.particles.update(dt); this.updateWeather(dt); this.updateCamera(dt, time);
            this.ambient.update(dt, this.camLook.x, this.camLook.z, time); this.birds.update(dt, time, this.camLook.x, this.camLook.z);
            if (this.ground.visible) { this.ground.position.x = this.camLook.x; this.ground.position.z = this.camLook.z; }

            if (this.cloudGroup.visible) {
              const R = 38;
              for (const cl of this.cloudKids) {
                cl.position.x += cl.userData.v * dt;
                if (cl.position.x - this.camLook.x > R) cl.position.x -= 2 * R; else if (this.camLook.x - cl.position.x > R) cl.position.x += 2 * R;
                if (cl.position.z - this.camLook.z > R) cl.position.z -= 2 * R; else if (this.camLook.z - cl.position.z > R) cl.position.z += 2 * R;
              }
            }

            if (this.glow) this.glow.visible = false;
          }
          this.renderer.render(this.scene, this.camera);
        }

        updatePlaying(dt) {
          const s = this.segs[this.k], d = s.dir;
          const currentSpeedMult = this.getSpeedMult();
          this.audio.setTempo(currentSpeedMult);
          const speed = (this.def.upb * this.def.bpm * currentSpeedMult) / 60;
          this.pos.x += d.x * speed * dt; this.pos.z += d.z * speed * dt;
          this.updateHeadBox();
          this.traveled = s.startDist + (this.pos.x - s.start.x) * d.x + (this.pos.z - s.start.z) * d.z;
          const pct = clamp(Math.floor((this.traveled / this.totalDist) * 100), 0, 100);
          if (pct !== this.pct) { this.pct = pct; this.ui.setPct(pct); }
          if (this.def.guide && this.turns < 3 && this.k < this.segs.length - 1) { const toCorner = s.aEnd - (s.dirIdx ? this.pos.z : this.pos.x); this.ui.showTapNow(toCorner < 2.0 && toCorner > -0.3); }
          if (this.hitWall()) return this.die("crash");
          if (!this.onFloor()) return this.die("fall");
          if (this.traveled >= this.totalDist - 0.3) this.finish();
        }
        onFloor() {
          const x = this.pos.x, z = this.pos.z;
          for (let j = Math.max(0, this.k - 2); j <= Math.min(this.segs.length - 1, this.k + 2); j++) { const f = this.segs[j].floor; if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return true; }
          return false;
        }
        hitWall() {
          const h = LINE_W / 2 - 0.1, x0 = this.pos.x - h, x1 = this.pos.x + h, z0 = this.pos.z - h, z1 = this.pos.z + h;
          for (let j = Math.max(0, this.k - 1); j <= Math.min(this.segs.length - 1, this.k + 1); j++) {
            const s = this.segs[j];
            for (const a of s.walls) if (x1 > a.x0 && x0 < a.x1 && z1 > a.z0 && z0 < a.z1) return true;
            for (const a of s.obstacles) if (x1 > a.x0 && x0 < a.x1 && z1 > a.z0 && z0 < a.z1) return true;
          }
          return false;
        }
        isOnFloor(x, z) {
          for (let j = 0; j < this.segs.length; j++) {
            const f = this.segs[j].floor;
            if (f && x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return true;
          }
          return false;
        }

        updateDead(dt) {
          this.deadT += dt;
          if (this.shatterCubes && this.shatterCubes.length) {
            const g = 14;
            const fadeStart = 0.6;
            const fadeEnd = 1.25;
            const scaleMult = this.deadT > fadeStart ? Math.max(0.0001, 1 - easeOutCubic(clamp((this.deadT - fadeStart) / (fadeEnd - fadeStart), 0, 1))) : 1;

            for (const c of this.shatterCubes) {
              c.vel.y -= g * dt;
              c.mesh.position.x += c.vel.x * dt;
              c.mesh.position.y += c.vel.y * dt;
              c.mesh.position.z += c.vel.z * dt;
              c.mesh.rotation.x += c.rot.x * dt;
              c.mesh.rotation.y += c.rot.y * dt;
              c.mesh.rotation.z += c.rot.z * dt;
              c.mesh.scale.setScalar(c.size * scaleMult);

              const onRoad = this.isOnFloor(c.mesh.position.x, c.mesh.position.z);
              const roadSurfaceY = c.size / 2;

              if (!c.fellOff) {
                if (onRoad) {
                  if (c.mesh.position.y < roadSurfaceY) {
                    c.mesh.position.y = roadSurfaceY;
                    if (c.vel.y < -0.3) {
                      c.vel.y = Math.abs(c.vel.y) * 0.3;
                    } else {
                      c.vel.y = 0;
                    }
                    c.vel.x *= 0.86;
                    c.vel.z *= 0.86;
                    c.rot.multiplyScalar(0.85);
                  }
                } else if (c.mesh.position.y < roadSurfaceY) {
                  c.fellOff = true;
                }
              }

              if (c.fellOff && this.groundY != null && c.mesh.position.y < this.groundY + c.size / 2) {
                c.mesh.position.y = this.groundY + c.size / 2;
                if (c.vel.y < -0.4) {
                  c.vel.y = Math.abs(c.vel.y) * 0.32;
                } else {
                  c.vel.y = 0;
                }
                c.vel.x *= 0.75;
                c.vel.z *= 0.75;
                c.rot.multiplyScalar(0.7);
              }
            }
          }
          if (this.piece) {
            const p = this.piece; p.t += dt;
            const ang = Math.min(1.7, 5 * p.t * p.t); p.pivot.quaternion.setFromAxisAngle(p.axis, ang);
            if (p.t > 0.16 && !p.landed) { p.vy -= 22 * dt; p.pivot.position.y += p.vy * dt; }
            if (p.t < 0.6 && !p.landed) { p.pivot.position.x += p.dir.x * 1.1 * dt; p.pivot.position.z += p.dir.z * 1.1 * dt; }
            if (this.groundY != null && !p.landed && p.pivot.position.y < this.groundY + 0.15) {
              p.landed = true; p.pivot.position.y = this.groundY + 0.15;
            }
          }
          this.shake = Math.max(0, this.shake - dt);
          if (this.deadT > 1.35) {
            this.state = "over";
            const rec = recFor(this.save, this.def.id);
            this.ui.showOver({ pct: this.pct, best: rec.best, newBest: this.newBest, gems: this.gemsRun, crowns: this.crowns.map((c) => c.used ? "used" : c.state === 1 ? "got" : "none"), left: this.held.length, practice: this.practice != null });
          }
        }

        updateFinishing(dt) {
          this.finT += dt;
          const s = this.segs[this.k], d = s.dir, speed = (this.def.upb * this.def.bpm * this.getSpeedMult()) / 60;
          const targetAlong = s.aEnd + 1.6; // exact center of victory portal arch
          const curAlong = s.dirIdx ? this.pos.z : this.pos.x;

          if (curAlong < targetAlong) {
            const move = Math.min(speed * dt, targetAlong - curAlong);
            this.pos.x += d.x * move;
            this.pos.z += d.z * move;
            this.updateHeadBox();
          }

          if (this.finT > 0.4 && !this.confetti) {
            this.confetti = true; const fp = this.finishPos, c = this.colors;
            this.particles.burst(new THREE.Vector3(fp.x, 1.8, fp.z), [c.line, c.gem, 0xffd166, 0xffffff, c.floorTop], 70, { speed: 7, up: 8, gravity: 7, life: 2.2, size: 0.22, additive: false });
          }
          if (this.finT > 1.35) {
            this.state = "complete"; this.audio.stop(1.2);
            this.ui.showComplete({ gems: this.gemsRun, kept: this.held.length, crowns: this.crowns.map((c) => c.used ? "used" : "got"), next: this.levelIdx < LEVELS.length - 1, practice: this.practice != null });
          }
        }

        /**
         * Scenery reveal: each wall piece, key, prop, marker and collectible has
         * its own trigger distance, so everything appears right where the road
         * cubes are forming instead of one whole segment at a time.
         */
        updateReveals(dt) {
          const list = this.revealList;
          while (this.revealPtr < list.length && list[this.revealPtr].userData.rv.at <= this.traveled) {
            const it = list[this.revealPtr++], rv = it.userData.rv;
            if (it.userData.crown && it.userData.crown.state === 1) { rv.done = true; it.visible = false; continue; }
            if (it.userData.gem && it.userData.gem.state === 1) { rv.done = true; it.visible = false; continue; }
            if (!rv.done && !rv.on) { rv.on = true; rv.t = 0; this.activeReveals.push(it); }
          }
          while (this.behind < this.chunks.length && this.chunks[this.behind].seg.endDist < this.traveled - 22) { this.chunks[this.behind].group.visible = false; this.behind++; }
          const act = this.activeReveals;
          for (let i = act.length - 1; i >= 0; i--) {
            const it = act[i], rv = it.userData.rv;
            if (it.userData.crown && it.userData.crown.state === 1) { rv.done = true; it.visible = false; act.splice(i, 1); continue; }
            if (it.userData.gem && it.userData.gem.state === 1) { rv.done = true; it.visible = false; act.splice(i, 1); continue; }
            rv.t += dt;
            const u = (rv.t - rv.delay) / rv.dur;
            if (u <= 0) { it.visible = false; continue; }
            it.visible = true;
            if (u >= 1) { it.position.y = rv.ty; it.scale.y = rv.sy; rv.done = true; rv.on = false; act.splice(i, 1); continue; }
            const e = easeOutCubic(u);
            it.position.y = rv.from === "above" ? rv.ty + rv.depth * (1 - e) : rv.ty - rv.depth * (1 - e);
            if (rv.grow) it.scale.y = rv.sy * Math.max(0.05, easeOutCubic(u));
          }
        }

        /**
         * Reveal one road cell after another. Cells rise and scale smoothly into place.
         */
        updateCellReveals(dt) {
          while (this.cellPending < this.cells.length && this.cells[this.cellPending].revealAt <= this.traveled) {
            const c = this.cells[this.cellPending++];
            if (c.state === 0) { c.state = 1; c.t = 0; c.mesh.visible = true; this.activeCells.push(c); }
          }

          while (this.cellBehind < this.cells.length && this.cells[this.cellBehind].dist < this.traveled - 24) {
            const c = this.cells[this.cellBehind++];
            if (c.state === 2) { c.state = 3; c.mesh.visible = false; }
          }

          const act = this.activeCells;
          const DUR = 0.48;
          for (let i = act.length - 1; i >= 0; i--) {
            const c = act[i];
            c.t += dt;
            if (c.t < 0) { c.mesh.visible = false; continue; }
            c.mesh.visible = true;
            const u = clamp(c.t / DUR, 0, 1);
            const inv = 1 - u;
            const rise = 1 - inv * inv * inv;
            const grow = 1 - inv * inv * inv * inv;

            c.mesh.position.y = c.targetY - 2.4 * (1 - rise);
            c.mesh.scale.y = c.sy * (0.35 + 0.65 * rise);

            const startSx = c.sx * 0.45;
            const startSz = c.sz * 0.45;
            c.mesh.scale.x = startSx + (c.finalSx - startSx) * grow;
            c.mesh.scale.z = startSz + (c.finalSz - startSz) * grow;

            if (u >= 1) {
              c.state = 2;
              c.mesh.position.y = c.targetY;
              c.mesh.scale.set(c.finalSx, c.sy, c.finalSz);
              act.splice(i, 1);
            }
          }
        }

        updateCollectibles(dt, time) {
          const playing = this.state === "playing";
          for (const g of this.gems) {
            if (g.state === 0) {
              if (!g.mesh.userData.rv.done) continue;
              g.mesh.position.y = 0.9 + Math.sin(time * 3 + g.phase) * 0.1; g.mesh.rotation.y += dt * 2.2;
              if (g.halo) g.halo.scale.setScalar(1.35 + Math.sin(time * 3.4 + g.phase) * 0.28);
              if (playing) { const dx = g.x - this.pos.x, dz = g.z - this.pos.z; if (dx * dx + dz * dz < PICK_R * PICK_R) this.collectGem(g); }
            } else if (g.state === 1 && g.t < 0.35) {
              g.t += dt; const u = Math.min(1, g.t / 0.35); g.mesh.position.y += dt * 2; g.mesh.rotation.y += dt * 10;
              g.mesh.scale.setScalar(u < 0.3 ? 1 + u * 1.5 : Math.max(0.001, 1.45 * (1 - (u - 0.3) / 0.7)));
              if (u >= 1) g.mesh.visible = false;
            } else if (g.state === 1) {
              g.mesh.visible = false;
            }
          }
          for (const c of this.crowns) {
            if (c.state === 0) {
              if (!c.mesh.userData.rv.done) continue;
              c.mesh.position.y = 1.05 + Math.sin(time * 2.4 + c.idx) * 0.1; c.mesh.rotation.y += dt * 1.4;
              if (c.halo) c.halo.scale.setScalar(2.1 + Math.sin(time * 2.6 + c.idx) * 0.35);
              if (playing) {
                const s = c.seg, along = s.dirIdx ? this.pos.z : this.pos.x, lat = s.dirIdx ? this.pos.x - s.start.x : this.pos.z - s.start.z;
                if (Math.abs(along - c.along) < 0.6 && Math.abs(lat) < s.w / 2 + 0.3) this.collectCrown(c);
              }
            } else if (c.state === 1 && c.t < 0.5) {
              c.t += dt; const u = Math.min(1, c.t / 0.5); c.mesh.position.y += dt * 2.4; c.mesh.rotation.y += dt * 9;
              c.mesh.scale.setScalar(u < 0.3 ? 1 + u * 1.2 : Math.max(0.001, 1.36 * (1 - (u - 0.3) / 0.7)));
              if (u >= 1) c.mesh.visible = false;
            } else if (c.state === 1) {
              c.mesh.visible = false;
            }
          }
        }
        collectGem(g) {
          g.state = 1; g.t = 0; this.gemsRun++;
          if (this.practice == null) {
            const rec = recFor(this.save, this.def.id);
            rec.gems[g.idx] = 1;
            this.save.totalGems++;
            storeSave(this.save); this.ui.updateWallet();
          }
          this.audio.gem(); this.ui.setGems(this.gemsRun);
          this.particles.burst(new THREE.Vector3(g.x, 1, g.z), [this.colors.gem, 0xffffff], 10, { speed: 2.6, up: 2.4, gravity: 8, life: 0.5, size: 0.08 });
        }
        collectCrown(c) {
          c.state = 1; c.t = 0;
          c.cp = { k: c.seg.i, pos: { x: c.pos.x, z: c.pos.z }, traveled: c.dist };
          this.held.push(c);
          let unlockedNow = false;
          if (this.practice == null) {
            const next = this.levelIdx + 1, before = next < LEVELS.length && isUnlocked(this.save, next);
            const rec = recFor(this.save, this.def.id); rec.crowns[c.idx] = 1; storeSave(this.save);
            unlockedNow = next < LEVELS.length && !before && isUnlocked(this.save, next);
          }
          this.audio.crown(); this.ui.setCrown(c.idx, "got", true); this.ui.toast("Checkpoint", "crown");
          if (unlockedNow) { const name = LEVELS[this.levelIdx + 1].name; setTimeout(() => { if (this.state === "playing") { this.ui.toast(name + " unlocked", "star"); this.audio.unlockJingle(); } }, 1700); }
          this.particles.burst(new THREE.Vector3(c.pos.x, 1.2, c.pos.z), [0xffd166, 0xffffff, 0xffa000], 18, { speed: 3.2, up: 3, gravity: 8, life: 0.7, size: 0.1 });
        }

        updateKeys(dt) {
          if (!this.head) return;
          const f = 1 - Math.exp(-22 * dt);
          for (let j = Math.max(0, this.k - 1); j <= Math.min(this.chunks.length - 1, this.k + 1); j++) {
            const c = this.chunks[j]; if (!c.keys.length) continue;
            const along = c.seg.dirIdx ? this.pos.z : this.pos.x;
            for (const key of c.keys) {
              if (!key.meshes[0].userData.rv.done) continue;
              const target = this.state === "playing" && Math.abs(key.along - along) < 0.6 ? 1 : 0;
              key.press += (target - key.press) * f;
              for (const m of key.meshes) m.position.y = m.userData.rv.ty - 0.13 * key.press;
            }
          }
        }
        updatePulse() {
          // Scenery and terrain remain stably positioned on the ground once revealed.
        }
        updateWeather(dt) {
          if (this.def.weather !== "storm") { if (this.flash > 0) { this.flash = 0; this.applyFlash(); } return; }
          this.boltT -= dt;
          if (this.boltT <= 0) { this.boltT = 5 + Math.random() * 7; this.flash = 1; this.audio.thunder(0.35 + Math.random() * 0.8); }
          if (this.flash > 0.001) { this.flash *= Math.exp(-7 * dt); this.applyFlash(); }
        }
        applyFlash() {
          const f = this.flash, L = this.def.light || 1;
          this.hemi.intensity = 1.8 * L * (1 + 2.5 * f);
          this.skyU.top.value.copy(this.skyBase.top).lerp(WHITE, 0.55 * f); this.skyU.bottom.value.copy(this.skyBase.bottom).lerp(WHITE, 0.55 * f);
        }

        updateCamera(dt, time) {
          let zt = 1;
          if (this.state === "home") zt = 1.08; else if (this.state === "finishing" || this.state === "complete") zt = 1.3; else { const s = this.segs[this.k]; zt = (s && s.sec.cam) || 1; }
          this.zoom += (zt - this.zoom) * (1 - Math.exp(-3.5 * dt));
          let tx, tz;
          if (this.state === "home") {
            tx = this.homeLook.x + Math.sin(time * 0.35) * 1.4; tz = this.homeLook.z + Math.cos(time * 0.28) * 1.4;
          } else if (this.state === "finishing" || this.state === "complete") {
            tx = this.finishPos ? this.finishPos.x : this.pos.x;
            tz = this.finishPos ? this.finishPos.z : this.pos.z;
          } else {
            tx = this.pos.x + LEAD; tz = this.pos.z + LEAD;
          }
          const f = 1 - Math.exp(-10 * dt);
          this.camLook.x += (tx - this.camLook.x) * f; this.camLook.z += (tz - this.camLook.z) * f;

          this.sun.position.set(this.camLook.x - 30, 50, this.camLook.z - 12);
          this.sun.target.position.set(this.camLook.x, 0, this.camLook.z); this.sun.target.updateMatrixWorld();

          const z = this.zoom * this.camScale, ox = CAM_OFF.x * z, oy = CAM_OFF.y * z, oz = CAM_OFF.z * z;
          const d = Math.hypot(ox, oy, oz); this.scene.fog.near = d * 1.2; this.scene.fog.far = d * 3.3;
          this.camera.position.set(this.camLook.x + ox, oy, this.camLook.z + oz);
          if (this.shake > 0) { const s = this.shake * 0.45; this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s; this.camera.position.z += (Math.random() - 0.5) * s; }
          this.camera.lookAt(this.camLook.x, 0, this.camLook.z);
          this.sky.position.copy(this.camera.position);
        }
      }

