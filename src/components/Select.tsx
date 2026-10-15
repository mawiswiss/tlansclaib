import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "./icons";

export type Option = { value: string; label: string };

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  chevron?: boolean;
  trigger?: (selected: Option | undefined) => ReactNode;
};

const GAP = 4;
const MARGIN = 8;
const PAGE = 8;

export function Select({ value, options, onChange, id, label, title, disabled, className, chevron = true, trigger }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const index = options.findIndex((o) => o.value === value);
  const selected = options[index];
  const optionId = (i: number) => `${listId}-${i}`;

  const show = (at: number) => {
    setActive(Math.max(0, at));
    setOpen(true);
    button.current?.focus();
  };

  const choose = (i: number) => {
    setOpen(false);
    const option = options[i];
    if (option && option.value !== value) onChange(option.value);
    button.current?.focus();
  };

  useLayoutEffect(() => {
    const anchor = button.current?.getBoundingClientRect();
    const list = menu.current;
    if (!open || !anchor || !list) return;
    list.style.minWidth = `${anchor.width}px`;
    const below = window.innerHeight - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const down = below >= Math.min(list.scrollHeight, 220) || below >= above;
    list.style.maxHeight = `${Math.max(120, Math.min(320, down ? below : above))}px`;
    const width = list.offsetWidth;
    list.style.left = `${Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))}px`;
    list.style.top = down ? `${anchor.bottom + GAP}px` : `${anchor.top - GAP - list.offsetHeight}px`;
    list.style.visibility = "visible";
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("mousedown", away);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("mousedown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const find = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 600 ? typed.current.text + key : key, at: now };
    const text = typed.current.text.toLowerCase();
    const start = open ? active : Math.max(index, 0);
    const order = options.map((_, i) => (start + (text.length === 1 ? 1 : 0) + i) % options.length);
    return order.find((i) => options[i].label.toLowerCase().startsWith(text)) ?? -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      if (open) setActive(Math.max(0, Math.min(last, to)));
      else show(Math.max(0, Math.min(last, to)));
    };
    switch (e.key) {
      case "ArrowDown":
        return open ? move(active + 1) : move(Math.max(index, 0));
      case "ArrowUp":
        return open ? move(active - 1) : move(Math.max(index, 0));
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(active + PAGE);
      case "PageUp":
        return move(active - PAGE);
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(active);
        else show(Math.max(index, 0));
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const found = find(e.key);
          if (found >= 0) move(found);
        }
    }
  };

  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={label}
        title={title}
        disabled={disabled}
        className={`select-trigger${className ? ` ${className}` : ""}`}
        onClick={() => (open ? setOpen(false) : show(Math.max(index, 0)))}
        onKeyDown={onKeyDown}
      >
        {trigger ? trigger(selected) : <span className="select-value">{selected?.label ?? ""}</span>}
        {chevron && <ChevronDown className="select-chevron" size={14} />}
      </button>
      {open &&
        createPortal(
          <ul ref={menu} id={listId} role="listbox" aria-label={label} className="select-menu" tabIndex={-1}>
            {options.map((option, i) => (
              <li
                key={option.value}
                id={optionId(i)}
                role="option"
                aria-selected={option.value === value}
                className={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} strokeWidth={2.2} />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
