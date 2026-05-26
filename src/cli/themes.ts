export interface ThemeIcons {
  prompt: string;
  success: string;
  error: string;
  edit: string;
  read: string;
  cmd: string;
  search: string;
  thinking: string;
  status: string;
}

export interface ThemeBox {
  tl: string;
  bl: string;
  tr: string;
  br: string;
  v: string;
  h: string;
}

export interface ThemeColorFns {
  primary: (s: string) => string;
  secondary: (s: string) => string;
  success: (s: string) => string;
  error: (s: string) => string;
  warning: (s: string) => string;
  info: (s: string) => string;
  search: (s: string) => string;
  muted: (s: string) => string;
  code: (s: string) => string;
  stream: (s: string) => string;
  banner: ((s: string) => string)[];
}

export interface Theme extends ThemeColorFns {
  name: string;
  icons: ThemeIcons;
  box: ThemeBox;
}

// Chalk-like interface matching renderer
interface ChalkLike {
  dim(value: string): string;
  gray(value: string): string;
  white(value: string): string;
  cyan(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  red(value: string): string;
  blue(value: string): string;
  magenta(value: string): string;
  bold(value: string): string;
}

function identity(s: string): string { return s; }

// ─── Theme builders ──────────────────────────────────────────────────────────

function buildMelaTheme(chalk: ChalkLike): Theme {
  return {
    name: 'mela',
    primary: chalk.cyan,
    secondary: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    search: chalk.magenta,
    muted: chalk.dim,
    code: chalk.gray,
    stream: chalk.cyan,
    banner: [
      chalk.green, chalk.green,
      (s) => chalk.bold(chalk.yellow(s)), (s) => chalk.bold(chalk.yellow(s)),
      chalk.red, chalk.red,
    ],
    icons: {
      prompt: '\u276F',
      success: '\u2714',
      error: '\u2716',
      edit: '\u270E',
      read: '\u22B3',
      cmd: '$',
      search: '\u2315',
      thinking: '\u2022',
      status: '\u2139',
    },
    box: {
      tl: '\u250C', bl: '\u2514', tr: '\u2510', br: '\u2518',
      v: '\u2502', h: '\u2500',
    },
  };
}

function buildNordTheme(chalk: ChalkLike): Theme {
  return {
    name: 'nord',
    primary: chalk.cyan,
    secondary: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    search: chalk.magenta,
    muted: chalk.dim,
    code: chalk.white,
    stream: chalk.cyan,
    banner: [
      chalk.blue, chalk.blue,
      chalk.cyan, chalk.cyan,
      chalk.magenta, chalk.magenta,
    ],
    icons: {
      prompt: '\u276F',
      success: '\u2714',
      error: '\u2716',
      edit: '\u270E',
      read: '\u22B3',
      cmd: '$',
      search: '\u2315',
      thinking: '\u2022',
      status: '\u2139',
    },
    box: {
      tl: '\u250C', bl: '\u2514', tr: '\u2510', br: '\u2518',
      v: '\u2502', h: '\u2500',
    },
  };
}

function buildCatppuccinTheme(chalk: ChalkLike): Theme {
  return {
    name: 'catppuccin',
    primary: chalk.blue,
    secondary: chalk.cyan,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    search: chalk.magenta,
    muted: chalk.dim,
    code: chalk.white,
    stream: chalk.blue,
    banner: [
      chalk.magenta, chalk.magenta,
      chalk.blue, chalk.blue,
      chalk.cyan, chalk.cyan,
    ],
    icons: {
      prompt: '\u276F',
      success: '\u2714',
      error: '\u2716',
      edit: '\u270E',
      read: '\u22B3',
      cmd: '$',
      search: '\u2315',
      thinking: '\u2022',
      status: '\u2139',
    },
    box: {
      tl: '\u250C', bl: '\u2514', tr: '\u2510', br: '\u2518',
      v: '\u2502', h: '\u2500',
    },
  };
}

function buildGruvboxTheme(chalk: ChalkLike): Theme {
  return {
    name: 'gruvbox',
    primary: chalk.green,
    secondary: chalk.yellow,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    search: chalk.magenta,
    muted: chalk.dim,
    code: chalk.white,
    stream: chalk.green,
    banner: [
      chalk.green, chalk.green,
      chalk.yellow, chalk.yellow,
      chalk.red, chalk.red,
    ],
    icons: {
      prompt: '\u276F',
      success: '\u2714',
      error: '\u2716',
      edit: '\u270E',
      read: '\u22B3',
      cmd: '$',
      search: '\u2315',
      thinking: '\u2022',
      status: '\u2139',
    },
    box: {
      tl: '\u250C', bl: '\u2514', tr: '\u2510', br: '\u2518',
      v: '\u2502', h: '\u2500',
    },
  };
}

function buildMinimalTheme(chalk: ChalkLike): Theme {
  return {
    name: 'minimal',
    primary: identity,
    secondary: identity,
    success: identity,
    error: identity,
    warning: identity,
    info: identity,
    search: identity,
    muted: chalk.dim,
    code: identity,
    stream: identity,
    banner: [identity, identity, identity, identity, identity, identity],
    icons: {
      prompt: '>',
      success: '[OK]',
      error: '[!!]',
      edit: '~',
      read: '<',
      cmd: '!',
      search: '?',
      thinking: '-',
      status: 'i',
    },
    box: {
      tl: '+', bl: '+', tr: '+', br: '+',
      v: '|', h: '-',
    },
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

type ThemeBuilder = (chalk: ChalkLike) => Theme;

const themeBuilders: Record<string, ThemeBuilder> = {
  mela: buildMelaTheme,
  nord: buildNordTheme,
  catppuccin: buildCatppuccinTheme,
  gruvbox: buildGruvboxTheme,
  minimal: buildMinimalTheme,
};

export function buildTheme(name: string, chalk: ChalkLike): Theme {
  const builder = themeBuilders[name.toLowerCase()];
  if (!builder) return buildMelaTheme(chalk);
  return builder(chalk);
}

export function defaultThemeName(): string {
  return 'mela';
}

export function listThemes(): string[] {
  return Object.keys(themeBuilders);
}
