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
        background: '#09090e',
        surface: {
          50: '#1e1e2d',
          100: '#161622',
          200: '#101018',
          300: '#0c0c12',
          DEFAULT: '#13131c',
        },
        border: 'rgba(255, 255, 255, 0.08)',
        accent: {
          purple: '#cb3cff',
          violet: '#7b2cbf',
          cyan: '#00e5ff',
          emerald: '#00e5a0',
          amber: '#ffd200',
          rose: '#ff4d6a',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Plus Jakarta Sans', 'sans-serif'],
        impact: ['Impact', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 25px -5px rgba(203, 60, 255, 0.3)',
        'glow-cyan': '0 0 25px -5px rgba(0, 229, 255, 0.3)',
        'glow-emerald': '0 0 25px -5px rgba(0, 229, 160, 0.3)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        }
      }
    },
  },
  plugins: [],
}
