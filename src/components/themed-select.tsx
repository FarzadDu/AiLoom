"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState,
  type KeyboardEvent, type OptionHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Choice = { value: string; label: ReactNode; searchText: string; disabled: boolean };

function plainText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) return plainText(value.props.children);
  return "";
}

export function selectChoices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child) || child.type !== "option") return [];
    const option = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
    const label = option.props.children;
    return [{ value: String(option.props.value ?? plainText(label)), label,
      searchText: plainText(label).trim().toLocaleLowerCase(), disabled: Boolean(option.props.disabled) }];
  });
}

type Props = {
  id?: string;
  name?: string;
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
};

/** Select-only combobox. Its listbox is portaled to escape clipped cards. */
export function ThemedSelect({ id, name, value, onValueChange, children, disabled = false,
  required, className, ariaLabel }: Props) {
  const choices = selectChoices(children);
  const selectedValue = String(value ?? "");
  const selectedIndex = choices.findIndex(choice => choice.value === selectedValue);
  const selected = choices[selectedIndex];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [missingRequired, setMissingRequired] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const [position, setPosition] = useState({ top: 0, left: 0, width: 200, maxHeight: 300 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef("");
  const searchTimeRef = useRef(0);
  const generatedId = useId().replace(/:/g, "");
  const triggerId = id ?? `ailoom-select-${generatedId}`;
  const listId = `${triggerId}-listbox`;
  const errorId = `${triggerId}-required`;
  const choiceKey = JSON.stringify(choices.map(choice => [choice.value, choice.disabled]));
  const searchable = choices.length > 12;
  const shownChoices = choices.map((choice, index) => ({ choice, index }))
    .filter(item => !searchable || !query.trim() ||
      `${item.choice.searchText} ${item.choice.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const enabledIndexes = shownChoices.filter(item => !item.choice.disabled).map(item => item.index);

  const updatePosition = () => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(window.innerWidth - 16, Math.max(box.width, 190));
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const placeAbove = below < 180 && above > below;
    const available = Math.max(100, placeAbove ? above : below);
    const maxHeight = Math.min(340, available);
    const expectedHeight = Math.min(maxHeight, shownChoices.length * 38 + 12 + (searchable ? 52 : 0));
    setPosition({ top: placeAbove ? Math.max(8, box.top - expectedHeight - 4) : box.bottom + 4,
      left, width, maxHeight });
  };

  const openMenu = () => {
    if (disabled || !choices.length) return;
    setQuery("");
    setActiveIndex(selectedIndex >= 0 && !choices[selectedIndex].disabled
      ? selectedIndex : Math.max(0, choices.findIndex(choice => !choice.disabled)));
    updatePosition();
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = choices[index];
    if (!option || option.disabled || searchable && !shownChoices.some(item => item.index === index)) return;
    onValueChange(option.value);
    setMissingRequired(false);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const move = (direction: number) => {
    if (!open) { openMenu(); return; }
    if (!enabledIndexes.length) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const next = position < 0 ? direction > 0 ? 0 : enabledIndexes.length - 1
      : (position + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[next]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu();
      let index = choices.findIndex(choice => !choice.disabled);
      if (event.key === "End") {
        index = -1;
        for (let candidate = choices.length - 1; candidate >= 0; candidate -= 1) {
          if (!choices[candidate].disabled) { index = candidate; break; }
        }
      }
      if (index >= 0) setActiveIndex(index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex); else openMenu();
      return;
    }
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); return; }
    if (event.key === "Tab" && open) { setOpen(false); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      searchRef.current = now - searchTimeRef.current < 700
        ? searchRef.current + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
      searchTimeRef.current = now;
      const index = choices.findIndex(choice => !choice.disabled && choice.searchText.startsWith(searchRef.current));
      if (index >= 0) { if (!open) openMenu(); setActiveIndex(index); }
    }
  };
  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault(); choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault(); setOpen(false); triggerRef.current?.focus();
    }
  };

  useEffect(() => { if (open && searchable) filterRef.current?.focus(); }, [open, searchable]);
  useEffect(() => { if (open) updatePosition(); }, [open, query, choiceKey]);
  useEffect(() => {
    if (!open || !searchable) return;
    if (!enabledIndexes.includes(activeIndex)) setActiveIndex(enabledIndexes[0] ?? 0);
  }, [open, searchable, query, choiceKey]);

  useEffect(() => {
    if (!open) return;
    if (!choices.length) { setOpen(false); return; }
    const preferred = choices[selectedIndex] && !choices[selectedIndex].disabled
      ? selectedIndex : choices.findIndex(choice => !choice.disabled);
    setActiveIndex(preferred >= 0 ? preferred : 0);
  }, [choiceKey, selectedValue]);
  useEffect(() => {
    if (selectedValue && choices.some(choice => choice.value === selectedValue && !choice.disabled)) setMissingRequired(false);
  }, [choiceKey, selectedValue]);
  useEffect(() => {
    if (!required || disabled) return;
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const checkRequired = (event: Event) => {
      if (selectedValue && choices.some(choice => choice.value === selectedValue && !choice.disabled)) return;
      event.preventDefault();
      event.stopPropagation();
      setMissingRequired(true);
      triggerRef.current?.focus();
    };
    form.addEventListener("submit", checkRequired, true);
    return () => form.removeEventListener("submit", checkRequired, true);
  }, [required, disabled, selectedValue, choiceKey]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-choice-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <div ref={rootRef} className={`ailoom-select${className ? ` ${className}` : ""}`}>
    {name && <input type="hidden" name={name} value={selectedValue} />}
    <button ref={triggerRef} id={triggerId} type="button" className="ailoom-select-trigger"
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && choices[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
      aria-label={ariaLabel} aria-required={required || undefined} aria-invalid={missingRequired || undefined}
      aria-describedby={missingRequired ? errorId : undefined} disabled={disabled}
      onClick={() => open ? setOpen(false) : openMenu()} onKeyDown={onKeyDown}>
      <span className="ailoom-select-value">{selected?.label ?? "—"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {missingRequired && <span id={errorId} className="ailoom-select-error" role="alert">{document.documentElement.lang === "fa" ? "یک گزینه انتخاب کنید." : "Choose an option."}</span>}
    {open && createPortal(<div ref={menuRef} className="ailoom-select-menu"
      dir={document.documentElement.dir === "rtl" ? "rtl" : "ltr"}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
      {searchable && <input ref={filterRef} className="ailoom-select-search" type="search"
        aria-label={document.documentElement.lang === "fa" ? "جست‌وجوی مدل" : "Search models"}
        aria-controls={listId} aria-activedescendant={shownChoices.some(item => item.index === activeIndex) ? `${listId}-option-${activeIndex}` : undefined}
        value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onFilterKeyDown} />}
      <div id={listId} role="listbox" aria-labelledby={ariaLabel ? undefined : triggerId} aria-label={ariaLabel}>
      {shownChoices.map(({ choice, index }) => <div key={`${choice.value}-${index}`} id={`${listId}-option-${index}`}
        data-choice-index={index} role="option" aria-selected={index === selectedIndex}
        aria-disabled={choice.disabled || undefined} className="ailoom-select-option"
        data-active={index === activeIndex ? "true" : undefined}
        onMouseEnter={() => !choice.disabled && setActiveIndex(index)}
        onClick={() => choose(index)}>
        <span>{choice.label}</span>{index === selectedIndex && <Check size={15} aria-hidden="true" />}
      </div>)}
      {!shownChoices.length && <p className="ailoom-select-empty" role="status">{document.documentElement.lang === "fa" ? "مدلی پیدا نشد." : "No matching models."}</p>}
      </div>
    </div>, document.body)}
  </div>;
}
