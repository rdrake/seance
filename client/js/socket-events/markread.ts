import socket from "../socket";
import {store} from "../store";

// The read marker moved on another session of the same account
// (`draft/read-marker`): sync the unread badge and marker like `open` does,
// but only up to the message the marker points at.
socket.on("markread", function (data) {
	const channel = store.getters.findChannel(data.chan);

	if (!channel) {
		return;
	}

	channel.channel.unread = data.unread;
	channel.channel.highlight = data.highlight;

	// The open conversation's new-messages line stays put while it is read.
	if (store.state.activeChannel && store.state.activeChannel.channel.id === data.chan) {
		return;
	}

	if (data.firstUnread !== 0) {
		channel.channel.firstUnread = data.firstUnread;
	}
});
