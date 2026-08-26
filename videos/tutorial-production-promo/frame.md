# Frame Design System: Cyber Velocity Dark

## Tokens & Theme

```css
:root {
  --bg-primary: #07080b;
  --bg-surface: #0e121b;
  --bg-card: rgba(18, 24, 38, 0.75);
  --border-glow: rgba(0, 242, 254, 0.3);
  
  --accent-cyan: #00f2fe;
  --accent-blue: #4facfe;
  --accent-purple: #7f00ff;
  --accent-magenta: #e100ff;
  --accent-gold: #ffd200;
  --accent-red: #ff3366;

  --text-pure: #ffffff;
  --text-muted: #94a3b8;
  --text-dim: #475569;

  --font-display: 'Outfit', 'Montserrat', -apple-system, sans-serif;
  --font-hero: 'Bebas Neue', 'Impact', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --shadow-neon-cyan: 0 0 30px rgba(0, 242, 254, 0.4), 0 0 80px rgba(0, 242, 254, 0.15);
  --shadow-neon-purple: 0 0 30px rgba(225, 0, 255, 0.4), 0 0 80px rgba(225, 0, 255, 0.15);
  --shadow-gold: 0 0 35px rgba(255, 210, 0, 0.45);
}
```

## Motion Design Rules
1. All elements animate using paused GSAP timelines hooked to `window.__timelines.promo`.
2. Easing: `power4.out` for snappy entrances, `expo.inOut` for sweeping wipes, `back.out(1.8)` for badge pops.
3. 3D perspective depth: Container perspective set to `1200px` with hardware-accelerated transforms (`transform3d`).
4. Glassmorphism: `backdrop-filter: blur(16px)` with subtle 1px translucent borders (`border: 1px solid rgba(255, 255, 255, 0.12)`).
