import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  currencyInput,
  formatBrazilianCurrencyTyping,
  parseBrazilianCurrency,
} from '../core/models';

@Directive({
  selector: 'input[appCurrency]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputDirective),
      multi: true,
    },
  ],
})
export class CurrencyInputDirective implements ControlValueAccessor {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.element.type = 'text';
    this.element.inputMode = 'decimal';
    this.element.autocomplete = 'off';
    this.element.placeholder ||= '0,00';
  }
  writeValue(value: number | null): void {
    this.element.value = value == null ? '' : currencyInput.format(value);
  }
  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.element.disabled = disabled;
  }
  @HostListener('input') input() {
    const { display, value } = formatBrazilianCurrencyTyping(this.element.value);
    this.element.value = display;
    this.element.setSelectionRange(display.length, display.length);
    this.onChange(value);
  }
  @HostListener('blur') blur() {
    const value = parseBrazilianCurrency(this.element.value);
    this.element.value = value == null ? '' : currencyInput.format(value);
    this.onChange(value);
    this.onTouched();
  }
  @HostListener('focus') focus() {
    requestAnimationFrame(() => this.element.select());
  }
}
