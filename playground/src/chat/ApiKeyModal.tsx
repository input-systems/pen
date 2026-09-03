import { useEffect, useRef, useState, type FormEvent } from "react";
import {
	getStoredAnthropicKey,
	setStoredAnthropicKey,
} from "../ai/apiKey";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface ApiKeyModalProps {
	open: boolean;
	onClose: () => void;
}

/**
 * Saves an Anthropic key in this browser so `/api/chat` can call the real
 * model without restarting Vite. The env file still wins if no key is stored.
 */
export function ApiKeyModal({ open, onClose }: ApiKeyModalProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [key, setKey] = useState("");
	const [hasStoredKey, setHasStoredKey] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		setHasStoredKey(getStoredAnthropicKey() !== undefined);
		setKey("");
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	const canSave = key.trim().length > 0;

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (!canSave) {
			return;
		}
		setStoredAnthropicKey(key);
		onClose();
	};

	const handleClear = () => {
		setStoredAnthropicKey(null);
		setHasStoredKey(false);
		setKey("");
	};

	return (
		<Modal open={open} title="Anthropic API key" onClose={onClose}>
			<form className="modal-form" onSubmit={handleSubmit}>
				<p className="modal-copy">
					Saved in this browser and sent with each chat request. Until
					a key is set here or in playground/.env.local, the scripted
					model answers.
				</p>
				<label className="modal-field">
					<span>API key</span>
					<input
						ref={inputRef}
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={key}
						placeholder={
							hasStoredKey
								? "A key is already saved"
								: "sk-ant-…"
						}
						onChange={(event) => setKey(event.target.value)}
					/>
				</label>
				<div className="modal-actions">
					{hasStoredKey ? (
						<Button kind="faded" onClick={handleClear}>
							Clear
						</Button>
					) : null}
					<Button
						type="submit"
						kind="secondary"
						disabled={!canSave}
					>
						Save
					</Button>
				</div>
			</form>
		</Modal>
	);
}
