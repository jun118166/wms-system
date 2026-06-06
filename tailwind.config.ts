import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0fc6c2',
        'primary-dark': '#0bada9',
        'primary-light': '#e8fafa',
        'primary-deep': '#0b6e6e',
      },
    },
  },
  plugins: [],
};
export default config;
