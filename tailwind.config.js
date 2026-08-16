/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-app)',
        surface: {
          50: 'var(--bg-surface-50)',
          100: 'var(--bg-surface-100)',
          200: 'var(--bg-surface-200)',
          300: 'var(--bg-surface-300)',
          DEFAULT: 'var(--bg-surface-100)',
        },
        border: 'var(--border-color)',
        'border-strong': 'var(--border-strong)',
        foreground: 'var(--text-primary)',
        muted: 'var(--text-muted)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Outfit', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      boxShadow: {
        subtle: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        elevation: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        pro: '0 0 0 1px var(--border-color), 0 4px 12px rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
}
