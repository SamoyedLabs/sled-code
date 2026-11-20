// Pinned i18n/format.ts file-size units and precision.
export const format = {
  date: (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, options).format(date),
  percent: (value: number, options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(undefined, { style: "percent", ...options }).format(value),
  fileSize: (bytes: number) => {
    let exponent = 0;
    while (exponent < 4 && bytes >= 1024 ** (exponent + 1)) exponent += 1;
    const amount =
      exponent === 0
        ? String(bytes)
        : exponent === 1
          ? String(Math.round(bytes / 1024))
          : new Intl.NumberFormat(undefined, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
              useGrouping: false,
            }).format(bytes / 1024 ** exponent);
    return `${amount} ${["B", "KB", "MB", "GB", "TB"][exponent]}`;
  },
};
