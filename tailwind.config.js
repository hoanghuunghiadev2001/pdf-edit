/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
  // Tránh xung đột style giữa Tailwind và Ant Design
  corePlugins: {
    preflight: true,
  },
};
