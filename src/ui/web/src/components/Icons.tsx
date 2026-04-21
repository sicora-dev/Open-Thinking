import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function Icon({
  size = 16,
  strokeWidth = 1.6,
  children,
  d,
  ...rest
}: IconProps & { d?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const Icons = {
  home: (
    <Icon d="M2.5 7l5.5-4.5L13.5 7v6.5a.5.5 0 0 1-.5.5H9.5v-4h-3v4H3a.5.5 0 0 1-.5-.5V7z" />
  ),
  play: (
    <Icon>
      <path d="M4 3l9 5-9 5V3z" fill="currentColor" stroke="none" />
    </Icon>
  ),
  flow: (
    <Icon>
      <circle cx="3.5" cy="4" r="1.5" />
      <circle cx="12.5" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <path d="M5 4h6M4.5 5.5l2.5 5M11.5 5.5l-2.5 5" />
    </Icon>
  ),
  box: (
    <Icon d="M2.5 4.5L8 2l5.5 2.5v7L8 14l-5.5-2.5v-7zM2.5 4.5L8 7l5.5-2.5M8 7v7" />
  ),
  plug: (
    <Icon>
      <path d="M4.5 1v3M11.5 1v3M3 4h10v3a5 5 0 0 1-10 0V4zM8 12v3" />
    </Icon>
  ),
  clock: (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.2 1.5" />
    </Icon>
  ),
  folder: (
    <Icon d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.3l1.5 1.5h5.2A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5z" />
  ),
  terminal: (
    <Icon>
      <path d="M2 2.5h12a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM4 6l2 2-2 2M8.5 10.5h3.5" />
    </Icon>
  ),
  skill: (
    <Icon>
      <path d="M8 1.5l2 4.5 5 .5-3.8 3.3 1.2 5-4.4-2.6-4.4 2.6 1.2-5L1 6.5l5-.5z" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M13 8a5 5 0 0 0-.1-1.1l1.4-1.1-1.4-2.4-1.7.6a5 5 0 0 0-1.9-1.1L9 1.5H7l-.3 1.4a5 5 0 0 0-1.9 1.1l-1.7-.6-1.4 2.4L3.1 6.9A5 5 0 0 0 3 8a5 5 0 0 0 .1 1.1L1.7 10.2l1.4 2.4 1.7-.6a5 5 0 0 0 1.9 1.1L7 14.5h2l.3-1.4a5 5 0 0 0 1.9-1.1l1.7.6 1.4-2.4-1.4-1.1A5 5 0 0 0 13 8z" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Icon>
  ),
  command: (
    <Icon>
      <path d="M4.5 2.5A1.5 1.5 0 1 1 6 4v8a1.5 1.5 0 1 1-1.5-1.5h7a1.5 1.5 0 1 1-1.5 1.5V4A1.5 1.5 0 1 1 11.5 2.5h-7z" />
    </Icon>
  ),
  plus: <Icon d="M8 3v10M3 8h10" />,
  chevRight: <Icon d="M6 3l5 5-5 5" />,
  chevDown: <Icon d="M3 6l5 5 5-5" />,
  dot: (
    <Icon>
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
    </Icon>
  ),
  check: <Icon d="M3 8.5L6.5 12 13 4.5" />,
  x: <Icon d="M4 4l8 8M12 4l-8 8" />,
  stop: (
    <Icon>
      <rect
        x="4"
        y="4"
        width="8"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </Icon>
  ),
  refresh: (
    <Icon d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4M12.5 1v3h-3M3.5 15v-3h3" />
  ),
  file: <Icon d="M3 2h6l3 3v9H3V2zM9 2v3h3" />,
  sun: (
    <Icon>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
    </Icon>
  ),
  moon: <Icon d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" />,
  bell: (
    <Icon d="M4 12V8a4 4 0 1 1 8 0v4l1 1.5H3l1-1.5zM6.5 13.5a1.5 1.5 0 0 0 3 0" />
  ),
  dollar: (
    <Icon d="M8 2v12M11 4.5H6.5a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3H5" />
  ),
  zap: <Icon d="M9 1.5L3 9h4l-1 5.5L12 7H8l1-5.5z" />,
  cpu: (
    <Icon>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
      <rect x="6" y="6" width="4" height="4" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
    </Icon>
  ),
  db: (
    <Icon>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.8" />
      <path d="M3 3.5v9c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-9M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
    </Icon>
  ),
  shield: (
    <Icon d="M8 1.5l5 1.5v5a6 6 0 0 1-5 6 6 6 0 0 1-5-6V3l5-1.5z" />
  ),
  arrowUp: <Icon d="M8 13V3M4 7l4-4 4 4" />,
  arrowDown: <Icon d="M8 3v10M4 9l4 4 4-4" />,
  arrowRight: <Icon d="M3 8h10M9 4l4 4-4 4" />,
  eye: (
    <Icon>
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  ),
  copy: (
    <Icon d="M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2M3 5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  edit: <Icon d="M10 2l4 4-8 8H2v-4l8-8zM8.5 3.5l4 4" />,
  trash: (
    <Icon d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1l.5-9" />
  ),
  menu: <Icon d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  external: <Icon d="M6 3H3v10h10v-3M9 3h4v4M8 8l5-5" />,
} as const;

export type IconName = keyof typeof Icons;
