# Manana Climb

A small, pirate-themed tide guide for the entry ramp at Manana Resort & Marina in Ladysmith, BC.

It uses official Canadian Hydrographic Service predictions for Ladysmith station **07460** and translates tide height into three locally chosen ramp conditions:

- **3.0 m or higher:** favourable angle
- **above 1.8 m and below 3.0 m:** usable, but increasingly steep
- **1.8 m or lower:** steepest and least desirable

## Local development

```bash
npm install
npm run dev
```

## Cloudflare Pages

- Framework preset: **Vite**
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: none

The app makes client-side requests to the Canadian Hydrographic Service IWLS API. Predictions are guidance only; actual ramp conditions and accessibility may vary.
