/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nexus: {
          50: '#f5f7ff',
          100: '#ebf0ff',
          200: '#d5deff',
          300: '#b3c2ff',
          400: '#8a9bff',
          500: '#6a7aff',
          600: '#5259f5',
          700: '#4344db',
          800: '#3839b1',
          900: '#31338c',
          950: '#1d1e57',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};
