/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Matches Reference_design: purple accent on a light grey-blue canvas.
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        canvas: '#f5f7fb',
        ink: {
          DEFAULT: '#111827',
          muted: '#6b7280',
          soft: '#9ca3af',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Noto Sans Bengali', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px rgba(16, 24, 40, 0.06)',
        lift: '0 8px 28px rgba(79, 70, 229, 0.16)',
      },
      minHeight: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};
