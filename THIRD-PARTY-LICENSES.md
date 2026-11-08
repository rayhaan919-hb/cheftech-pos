# Third-Party Licenses & Attributions

ChefTech POS uses the following open-source packages and assets:

## Runtime & Build Dependencies

| Package | License | Repository |
| :--- | :--- | :--- |
| `react` & `react-dom` | MIT | https://github.com/facebook/react |
| `dexie` | Apache-2.0 | https://github.com/dexie/Dexie.js |
| `lucide-react` | ISC | https://github.com/lucide-icons/lucide |
| `tailwindcss` | MIT | https://github.com/tailwindlabs/tailwindcss |
| `vite` | MIT | https://github.com/vitejs/vite |
| `vitest` | MIT | https://github.com/vitest-dev/vitest |
| `typescript` | Apache-2.0 | https://github.com/microsoft/TypeScript |

## Audio & Media Assets

- All notification and alert sounds in both the POS and Ordering Website are synthesized at runtime using the standard browser **Web Audio API (`AudioContext`)**. No external third-party audio files (`.mp3` / `.wav`) are bundled.
- Sample food photography URLs used in Demo Mode reference Unsplash images under the [Unsplash License](https://unsplash.com/license).
