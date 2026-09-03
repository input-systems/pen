import { setupWSConnection } from "@y/websocket-server/utils";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { COLLABORATION_ROUTE, roomFromPath } from "./collaborationRoute";

/**
 * Serves the Yjs websocket on the Vite dev server at `/collaboration/<room>`.
 *
 * y-websocket's reference server runs on its own process and port. The
 * playground keeps `pnpm dev` as the only command, the same way the chat
 * route does, by handling the upgrade on Vite's HTTP server.
 */
export function collaborationPlugin(): Plugin {
	return {
		name: "pen-playground-collaboration",
		configureServer(vite) {
			const sockets = new WebSocketServer({ noServer: true });
			sockets.on(
				"connection",
				(socket: WebSocket, request: IncomingMessage) => {
					setupWSConnection(socket, request, {
						docName: roomFromPath(pathnameOf(request)),
						gc: true,
					});
				},
			);

			vite.httpServer?.on("upgrade", (request, socket, head) => {
				if (!pathnameOf(request).startsWith(COLLABORATION_ROUTE)) {
					return;
				}
				sockets.handleUpgrade(
					request,
					socket as Duplex,
					head,
					(websocket: WebSocket) => {
						sockets.emit("connection", websocket, request);
					},
				);
			});
		},
	};
}

function pathnameOf(request: IncomingMessage): string {
	return new URL(request.url ?? "/", "http://localhost").pathname;
}
