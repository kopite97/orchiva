type KeyEvent = {
  key?: string;
  repeat?: boolean;
  nativeEvent?: { key?: string; repeat?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
};

// Paseo's web Pressable handles Enter, but a checkbox role also needs Space.
// Keep this web event extension separate from React Native's native-only types.
export function checkboxKeyboard(disabled: boolean, toggle: () => void) {
  return {
    onKeyDown(event: KeyEvent) {
      const key = event.key ?? event.nativeEvent?.key;
      if (key !== " " && key !== "Spacebar") return;
      event.preventDefault();
      event.stopPropagation();
      if (!disabled && !event.repeat && !event.nativeEvent?.repeat) toggle();
    },
  };
}
