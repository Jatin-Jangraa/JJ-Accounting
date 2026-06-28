/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#18202f',
        brand: '#2563eb',
        success: '#15803d',
        danger: '#b91c1c',
        warn: '#b45309'
      }
    }
  },
  plugins: []
};
