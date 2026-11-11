import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import type { PluginConfig } from 'streamdown'

/** Shiki highlighting for fenced code blocks, themed with the bundled Catppuccin Mocha theme. Mocha fills both theme slots because the app pins one flavour and has no light palette, and the plugin's themes win over any shikiTheme prop. */
const code = createCodePlugin({ themes: ['catppuccin-mocha', 'catppuccin-mocha'] })

/** KaTeX for `$...$` inline and `$$...$$` display math; singleDollarTextMath is the form models write, while streamdown's default parses only the double-dollar form. */
const math = createMathPlugin({ singleDollarTextMath: true })

export const markdownPlugins: PluginConfig = { code, math }
