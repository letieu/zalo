/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        zalo: {
          blue: "#0068ff",
          darkblue: "#0052cc",
          light: "#e5efff",
          chatbg: "#e4e8ec",
          card: "#ffffff",
          sidebar: "#f7f9fa",
        },
      },
    },
  },
  plugins: [],
}
