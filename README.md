# 🎵 Dancing Line — Rhythm Runner

> A vibrant, rhythm-driven endless runner built with modern Vanilla JavaScript, Three.js, and Web Audio API. Guide a glowing line along procedurally themed paths, stay on the beat, and collect diamonds without crashing.

[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](LICENSE)
[![HTML5 / CSS3 / ES6+](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20ES6%2B-brightgreen.svg)]()
[![Three.js](https://img.shields.io/badge/Three.js-0.186-blue.svg)](https://threejs.org/)

---

## ✨ Features

- **🗺️ 8 Themed Levels**:
  - Forest, desert, ice cave, and more — each with a unique palette, ambience (petals, birds, weather), and music tempo.
- **🎼 Procedural Audio Engine**:
  - A hand-built Web Audio synthesis engine drives the background music and sound effects — no audio files loaded.
- **🎯 Rhythm-Based Movement**:
  - The line moves and turns in time with each level's beats-per-minute, rewarding players who stay on rhythm.
- **💎 Collectibles & Scoring**:
  - Collect diamonds, hit checkpoint crowns, and track your best completion percentage per level.
- **🎨 Unlockable Line Skins**:
  - Unlock and equip alternate line skins using diamonds collected in-game.
- **💾 Progress Persistence**:
  - Level unlocks, best scores, crowns, and settings are saved to `localStorage` between sessions.
- **🏁 Practice Mode**:
  - Start a level from any unlocked checkpoint to practice a tricky section.
- **⚙️ Settings**:
  - Toggle music, sound effects, and screen shake independently.
- **📱 Responsive, Mobile-First UI**:
  - Touch-friendly HUD, home screen carousel, and modals that work across phone and desktop viewports.

---

## 🚀 Quick Start

No build tools or bundlers required! Because the game loads Three.js as an ES module, it needs to be served over HTTP (opening `index.html` directly via `file://` will not work in most browsers).

### Local Development / Running
1. Clone the repository:
   ```bash
   git clone https://github.com/jigarsonani1012/dancing-line.git
   cd dancing-line
   ```
2. Open `index.html` using a local web server (e.g., VS Code Live Server, `npx serve`, or `python -m http.server`).
3. Open `http://localhost:8000` in your web browser.

---

## 🕹️ Controls

| Control | Action |
| :--- | :--- |
| **Tap / Click anywhere** | Turn the line |
| **Pause button (top-left)** | Pause the run |
| **Mute button (top-right)** | Toggle sound on/off |
| **Arrow keys / swipe on home screen** | Browse levels |

---

## 🎮 Gameplay

Tap anywhere on the screen to turn the line 90°. The line moves forward automatically in time with the music — your job is to turn at the right moments to stay on the path, avoid obstacles, and collect diamonds along the way. Reach checkpoint crowns to bank your progress, and complete the level to earn stars and unlock the next one.

---

## 🛠️ Technologies

- **[Three.js](https://threejs.org/)** (via CDN import map) — 3D rendering
- **Web Audio API** — procedural music and sound effects, synthesized entirely in code
- **Vanilla JavaScript (ES modules)** — no framework, no bundler
- **CSS3** — HUD, menus, and animations
- **localStorage** — save data and settings persistence

---

## 📂 Project Architecture

```
dancing-line/
├── index.html    # App shell, DOM layout & inline SVG icon set
├── style.css     # HUD, menus, modals & animations
├── script.js     # Game engine, audio, levels, save system & UI logic
├── .gitignore    # Standard git ignore rules
├── LICENSE       # MIT License file
└── README.md     # Project documentation & guide
```

---

## 👤 Author

**Jigar Sonani**
* GitHub: [@jigarsonani1012](https://github.com/jigarsonani1012)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
