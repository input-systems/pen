import { useState } from "react";
import {
	readRoomFromUrl,
	readSession,
	readStoredUser,
	saveUserName,
	writeRoomToUrl,
	type CollaborationSession,
} from "./session";

interface JoinRequest {
	name: string;
	room: string;
}

/**
 * The room this tab is in, if any, and the modal that gets you into one.
 *
 * The URL carries the room and session storage carries the display name, so
 * a reload rejoins on its own. A session only exists once both are known.
 */
export function useCollaboration() {
	const [user, setUser] = useState(readStoredUser);
	const [session, setSession] = useState<CollaborationSession | null>(
		readSession,
	);
	// A shared `?room=` link is an invitation, not a join. Without a stored
	// name there is no session, so open the card and let them pick one.
	const [isModalOpen, setIsModalOpen] = useState(
		() => session === null && readRoomFromUrl() !== null,
	);

	const openModal = () => setIsModalOpen(true);
	const closeModal = () => setIsModalOpen(false);

	const join = ({ name, room }: JoinRequest) => {
		const nextUser = saveUserName(name);
		writeRoomToUrl(room);
		setUser(nextUser);
		setSession({ room, user: nextUser });
		setIsModalOpen(false);
	};

	const leave = () => {
		writeRoomToUrl(null);
		setSession(null);
		setIsModalOpen(false);
	};

	return {
		session,
		isModalOpen,
		defaultName: user.name,
		defaultRoom: session?.room ?? readRoomFromUrl() ?? "",
		openModal,
		closeModal,
		join,
		leave,
	};
}
