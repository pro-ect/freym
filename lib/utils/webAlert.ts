// Alert.alert is a NO-OP on react-native-web — these helpers render an
// in-app dialog (WebDialogHost) on web and fall back to native Alert on
// iOS/Android. Never use window.alert/confirm/prompt: they block the JS
// thread and are silently suppressed in automation contexts and many
// in-app browsers (Instagram/TikTok webviews), freezing the funnel.
import { Alert, Platform } from 'react-native';

export interface DialogRequest {
  kind: 'alert' | 'confirm' | 'prompt';
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  placeholder?: string;
  resolve: (result: any) => void;
}

type Presenter = (req: DialogRequest) => void;

let presenter: Presenter | null = null;

// Called by WebDialogHost on mount. Returns an unregister function.
export function registerDialogPresenter(fn: Presenter): () => void {
  presenter = fn;
  return () => {
    if (presenter === fn) presenter = null;
  };
}

function present(req: Omit<DialogRequest, 'resolve'>): Promise<any> {
  return new Promise((resolve) => {
    if (presenter) {
      presenter({ ...req, resolve });
      return;
    }
    // Host not mounted (shouldn't happen — DialogHost mounts at the app root).
    // On web fall back to window.* dialogs; on native those don't exist and
    // would throw, so degrade to native Alert (prompt can't be recreated →
    // resolve null so callers don't hang).
    const body = req.message ? `${req.title}\n\n${req.message}` : req.title;
    if (Platform.OS !== 'web') {
      if (req.kind === 'alert') {
        Alert.alert(req.title, req.message);
        resolve(undefined);
      } else if (req.kind === 'confirm') {
        Alert.alert(req.title, req.message, [
          { text: req.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: req.confirmText ?? 'OK', onPress: () => resolve(true) },
        ]);
      } else {
        resolve(null);
      }
      return;
    }
    if (req.kind === 'alert') {
      window.alert(body);
      resolve(undefined);
    } else if (req.kind === 'confirm') {
      resolve(window.confirm(body));
    } else {
      resolve(window.prompt(body));
    }
  });
}

export function showAlert(title: string, message?: string): void {
  // iOS uses the native Alert; web + Android route through the in-app host.
  if (Platform.OS !== 'ios') {
    present({ kind: 'alert', title, message, confirmText: 'OK' });
    return;
  }
  Alert.alert(title, message);
}

// Two-button confirm. Resolves true if the user accepts.
export function showConfirm(
  title: string,
  message: string | undefined,
  opts: { confirmText?: string; cancelText?: string; destructive?: boolean } = {},
): Promise<boolean> {
  const { confirmText = 'OK', cancelText = 'Cancel', destructive = false } = opts;
  if (Platform.OS !== 'ios') {
    return present({ kind: 'confirm', title, message, confirmText, cancelText, destructive });
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}

export interface PromptOptions {
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

// Single text input. Resolves null on cancel.
// `opts` may be a plain placeholder string (legacy) or an options object.
export function showPrompt(
  title: string,
  message?: string,
  opts?: string | PromptOptions,
): Promise<string | null> {
  const {
    placeholder,
    confirmText = 'Submit',
    cancelText = 'Cancel',
    destructive = false,
  } = typeof opts === 'string' ? { placeholder: opts } : (opts ?? {});

  // Alert.prompt is iOS-only. iOS uses it natively; web + Android route through
  // the in-app dialog host (DialogHost) so the prompt actually appears.
  if (Platform.OS !== 'ios') {
    return present({ kind: 'prompt', title, message, placeholder, confirmText, cancelText, destructive });
  }
  return new Promise((resolve) => {
    Alert.prompt(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(null) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: (text?: string) => resolve(text ?? null) },
      ],
      'plain-text',
      placeholder,
    );
  });
}
