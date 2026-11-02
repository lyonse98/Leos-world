/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // trymiles.app design language (Nov 2, 2026 friendliness pass):
      // warm cream ground, deep ink text, sage accents — the poster's
      // palette, replacing the hard slate-950 look Erik called harsh.
      colors: {
        cream: '#f3ede1',
        cream2: '#ece3d0',
        ink: '#15222d',
        inksoft: '#3d4c59',
        sage: '#6d8a63',
        sagedeep: '#4f6b47',
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
