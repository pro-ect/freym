import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  registerDialogPresenter,
  type DialogRequest,
} from '../../lib/utils/webAlert';

// App-wide host for showAlert/showConfirm/showPrompt (lib/utils/webAlert.ts).
// Realizes the in-app dialog the helper always referenced but never had — used
// on web and Android (Alert.prompt is iOS-only and no-ops on Android). iOS keeps
// the native Alert path, so this host stays idle there. Mounted once in
// app/_layout.tsx alongside GlobalAgentFab.
export default function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    return registerDialogPresenter((request) => {
      setText(request.placeholder ?? '');
      setReq(request);
    });
  }, []);

  if (!req) return null;

  const isPrompt = req.kind === 'prompt';
  const isConfirm = req.kind === 'confirm';
  const showCancel = isPrompt || isConfirm;

  const finish = (value: unknown) => {
    const { resolve } = req;
    setReq(null);
    setText('');
    resolve(value);
  };

  const onConfirm = () => {
    if (isPrompt) finish(text);
    else if (isConfirm) finish(true);
    else finish(undefined);
  };

  const onCancel = () => {
    if (isPrompt) finish(null);
    else if (isConfirm) finish(false);
    else finish(undefined);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{req.title}</Text>
          {!!req.message && <Text style={styles.message}>{req.message}</Text>}

          {isPrompt && (
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={req.placeholder}
              placeholderTextColor="#6b7280"
              autoFocus
              onSubmitEditing={onConfirm}
              returnKeyType="done"
            />
          )}

          <View style={styles.buttonRow}>
            {showCancel && (
              <TouchableOpacity style={styles.button} onPress={onCancel} activeOpacity={0.7}>
                <Text style={styles.cancelText}>{req.cancelText ?? 'Cancel'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.button} onPress={onConfirm} activeOpacity={0.7}>
              <Text style={[styles.confirmText, req.destructive && styles.destructiveText]}>
                {req.confirmText ?? 'OK'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  input: {
    backgroundColor: '#2c2c2e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '500',
  },
  confirmText: {
    color: '#0a84ff',
    fontSize: 16,
    fontWeight: '600',
  },
  destructiveText: {
    color: '#ff453a',
  },
});
