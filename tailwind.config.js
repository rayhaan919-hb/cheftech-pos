/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ui-bg': 'var(--ui-bg)',
        'ui-panel': 'var(--ui-panel)',
        'ui-panel-raised': 'var(--ui-panel-raised)',
        'ui-border': 'var(--ui-border)',
        'ui-text': 'var(--ui-text)',
        'ui-muted': 'var(--ui-muted)',
        'ui-accent': 'var(--ui-accent)',
        'ui-accent-soft': 'var(--ui-accent-soft)',
        'ui-success': 'var(--ui-success)',
        'ui-warning': 'var(--ui-warning)',
        'ui-danger': 'var(--ui-danger)',
        'fellow-primary': '#2941e0',
        'fellow-violet': '#795afa',
        'fellow-violet-light': '#c5b9fa',
        'fellow-navy': '#000524',
        'fellow-surface-1': '#e0edff',
        'fellow-surface-2': '#eff6ff',
        'fellow-hairline': '#b4c4cc',
        'fellow-hairline-light': '#d4d4d8',
        'fellow-ink': '#000000',
        'fellow-ink-muted': '#273238',
        'fellow-ink-subtle': '#526066',
        'fellow-ink-faint': '#616f75',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
