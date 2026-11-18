"use client";

import { useState } from "react";

const numberFormat = new Intl.NumberFormat("vi-VN");

/** Giữ lại chữ số, bỏ dấu chấm, dấu phẩy, khoảng trắng và chữ "đ". */
export function digitsOnly(text: string) {
  return text.replace(/\D/g, "");
}

function display(digits: string) {
  return digits === "" ? "" : numberFormat.format(Number(digits));
}

/**
 * Ô nhập tiền VNĐ.
 *
 * Người dùng quen gõ "3.500.000". Ô `type="number"` của trình duyệt coi chuỗi
 * đó là không hợp lệ và trả về rỗng — biểu mẫu vẫn gửi đi, nhưng với giá trị
 * mặc định, và không ai được báo là số vừa gõ đã bị bỏ. Ô này nhận mọi cách
 * gõ, tự chèn dấu chấm phân cách hàng nghìn, và gửi lên máy chủ một chuỗi chỉ
 * gồm chữ số.
 *
 * Dùng được theo hai kiểu, giống ô nhập thường:
 * - có `value` + `onValueChange`: cha giữ giá trị (chuỗi chữ số);
 * - chỉ có `name` (và `defaultValue`): tự giữ giá trị, biểu mẫu đọc qua
 *   `FormData` nhờ một ô ẩn mang `name`.
 */
export function MoneyInput({
  name,
  value,
  defaultValue,
  onValueChange,
  required,
  disabled,
  placeholder,
  className,
  title,
}: {
  name?: string;
  value?: string;
  defaultValue?: string | number | null;
  onValueChange?: (digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
}) {
  const [inner, setInner] = useState(() => digitsOnly(String(defaultValue ?? "")));
  const digits = value !== undefined ? digitsOnly(value) : inner;

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        title={title}
        value={display(digits)}
        onChange={(event) => {
          // Bỏ số 0 thừa ở đầu và chặn độ dài để không vượt số nguyên an toàn.
          const next = digitsOnly(event.target.value).replace(/^0+(?=\d)/, "").slice(0, 15);
          if (value === undefined) setInner(next);
          onValueChange?.(next);
        }}
      />
      {name && <input type="hidden" name={name} value={digits} disabled={disabled} />}
    </>
  );
}
