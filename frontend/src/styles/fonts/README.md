# Guest typography

The guest design uses locally served Latin WOFF2 copies of Fraunces (regular and italic), Manrope (variable weight) and Caveat (caption only). `guestFonts.css` declares them with `font-display: swap`; visiting the site does not contact a font provider.

Downloaded October 15, 2026 from the Google Fonts CSS API and its `fonts.gstatic.com` asset URLs. Original projects and license sources:

- [Fraunces](https://github.com/google/fonts/tree/main/ofl/fraunces)
- [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope)
- [Caveat](https://github.com/google/fonts/tree/main/ofl/caveat)

Their SIL Open Font License files are in `frontend/public/licenses/fonts/` so Vite includes them in the deployed site. Characters outside these Latin copies use the declared system fallbacks.
