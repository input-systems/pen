import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { suggestRoomId } from "./session";

interface CollaborateModalProps {
	open: boolean;
	defaultName: string;
	defaultRoom: string;
	live: boolean;
	onClose: () => void;
	onJoin: (next: { name: string; room: string }) => void;
	onLeave: () => void;
}

/**
 * Name and room, then join. When already live, the same card shows the room
 * you are in and a way out.
 */
export function CollaborateModal({
	open,
	defaultName,
	defaultRoom,
	live,
	onClose,
	onJoin,
	onLeave,
}: CollaborateModalProps) {
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(defaultName);
	const [room, setRoom] = useState(defaultRoom);

	useEffect(() => {
		if (!open) {
			return;
		}
		setName(defaultName);
		setRoom(defaultRoom || suggestRoomId());
		requestAnimationFrame(() => {
			nameRef.current?.focus();
			nameRef.current?.select();
		});
	}, [defaultName, defaultRoom, open]);

	const canJoin = name.trim().length > 0 && room.trim().length > 0;

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (!canJoin) {
			return;
		}
		onJoin({ name: name.trim(), room: room.trim() });
	};

	return (
		<Modal open={open} title="Live collaboration" onClose={onClose}>
			<form className="modal-form" onSubmit={handleSubmit}>
				<p className="modal-copy">
					Share this page — the room is in the URL. Your display
					name is what they see on your caret.
				</p>
				<label className="modal-field">
					<span>Your name</span>
					<input
						ref={nameRef}
						value={name}
						maxLength={40}
						placeholder="Ada Lovelace"
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label className="modal-field">
					<span>Room</span>
					<input
						value={room}
						maxLength={64}
						spellCheck={false}
						placeholder="pen-studio"
						onChange={(event) => setRoom(event.target.value)}
					/>
				</label>
				<div className="modal-actions">
					{live ? (
						<Button kind="faded" onClick={onLeave}>
							Leave room
						</Button>
					) : null}
					<Button type="submit" kind="secondary" disabled={!canJoin}>
						{live ? "Update" : "Join room"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
