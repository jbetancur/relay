import { createTheme } from '@mantine/core'

export const theme = createTheme({
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { radius: 'md' } },
    TextInput: { defaultProps: { radius: 'md' } },
    Textarea: { defaultProps: { radius: 'md' } },
    Select: { defaultProps: { radius: 'md' } },
  },
})

// Catppuccin Mocha — used only for chat bubbles and code blocks
export const mochaCssVars = `
  --ctp-base: #1e1e2e;
  --ctp-mantle: #181825;
  --ctp-crust: #11111b;
  --ctp-surface0: #313244;
  --ctp-surface1: #45475a;
  --ctp-surface2: #585b70;
  --ctp-overlay0: #6c7086;
  --ctp-subtext0: #a6adc8;
  --ctp-text: #cdd6f4;
  --ctp-sapphire: #74c7ec;
  --ctp-blue: #89b4fa;
  --ctp-mauve: #cba6f7;
  --ctp-peach: #fab387;
  --ctp-green: #a6e3a1;
  --ctp-red: #f38ba8;
  --ctp-yellow: #f9e2af;
  --ctp-teal: #94e2d5;
`

// Catppuccin Latte — used only for chat bubbles and code blocks
export const latteCssVars = `
  --ctp-base: #eff1f5;
  --ctp-mantle: #e6e9ef;
  --ctp-crust: #dce0e8;
  --ctp-surface0: #ccd0da;
  --ctp-surface1: #bcc0cc;
  --ctp-surface2: #acb0be;
  --ctp-overlay0: #9ca0b0;
  --ctp-subtext0: #6c6f85;
  --ctp-text: #4c4f69;
  --ctp-sapphire: #209fb5;
  --ctp-blue: #1e66f5;
  --ctp-mauve: #8839ef;
  --ctp-peach: #fe640b;
  --ctp-green: #40a02b;
  --ctp-red: #d20f39;
  --ctp-yellow: #df8e1d;
  --ctp-teal: #179299;
`
