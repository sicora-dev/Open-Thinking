type LogomarkProps = {
  height?: number;
};

export function Logomark({ height = 22 }: LogomarkProps) {
  return (
    <>
      <img src="/logo_dark_cropped.png" alt="OpenThinking" height={height} className="block dark:hidden" />
      <img src="/logo_cropped.png" alt="OpenThinking" height={height} className="hidden dark:block" />
    </>
  );
}

export function Wordmark({ height = 22 }: LogomarkProps) {
  return <Logomark height={height} />;
}
