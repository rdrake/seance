import {expect} from "chai";
import {
	applyReaction,
	findMessageById,
	insertMessage,
	removePending,
	replyQuote,
} from "../../client/js/helpers/messageUpdates";
import type {SharedMsg} from "../../shared/types/msg";

function msg(id: number, pending = false): SharedMsg {
	return {id, time: new Date(id * 1000), users: [], ...(pending ? {pending: true} : {})};
}

function ids(messages: SharedMsg[]): number[] {
	return messages.map((m) => m.id);
}

describe("Pending messages in the message list (helpers/messageUpdates.ts)", function () {
	describe("insertMessage", function () {
		it("appends when nothing is pending", function () {
			const messages = [msg(1), msg(2)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("keeps a pending message at the bottom", function () {
			const messages = [msg(1), msg(2, true)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 3, 2]);
		});

		it("puts a new pending message after the ones already waiting", function () {
			const messages = [msg(1), msg(2, true)];
			insertMessage(messages, msg(3, true));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("inserts before the whole trailing pending block", function () {
			const messages = [msg(1), msg(2, true), msg(3, true)];
			insertMessage(messages, msg(4));
			expect(ids(messages)).to.deep.equal([1, 4, 2, 3]);
		});

		it("leaves a copy standing in an edited message's place where it is", function () {
			// 2 is hidden behind its pending edit 3 (applyEdit): they are the
			// edited message, not the slot for the next echo.
			const messages = [msg(1), {...msg(2), supersededBy: 3}, msg(3, true)];
			insertMessage(messages, msg(4));
			expect(ids(messages)).to.deep.equal([1, 2, 3, 4]);

			insertMessage(messages, msg(5, true));
			insertMessage(messages, msg(6));
			expect(ids(messages)).to.deep.equal([1, 2, 3, 4, 6, 5]);
		});

		it("only looks at the trailing block", function () {
			const messages = [msg(1, true), msg(2)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("works on an empty list", function () {
			const messages: SharedMsg[] = [];
			insertMessage(messages, msg(1, true));
			insertMessage(messages, msg(2));
			expect(ids(messages)).to.deep.equal([2, 1]);
		});
	});

	describe("removePending", function () {
		it("removes the pending message with that id", function () {
			const messages = [msg(1), msg(2, true), msg(3, true)];
			expect(removePending(messages, 2)).to.equal(true);
			expect(ids(messages)).to.deep.equal([1, 3]);
		});

		it("leaves a message that is not pending alone", function () {
			const messages = [msg(1), msg(2)];
			expect(removePending(messages, 1)).to.equal(false);
			expect(ids(messages)).to.deep.equal([1, 2]);
		});

		it("shows the original again when the copy that stood in for it goes", function () {
			const messages = [msg(1), {...msg(2), supersededBy: 3}, msg(3, true)];
			expect(removePending(messages, 3)).to.equal(true);
			expect(ids(messages)).to.deep.equal([1, 2]);
			expect(messages[1].supersededBy).to.equal(undefined);
		});

		it("leaves an original hidden behind something else", function () {
			const messages = [msg(1), {...msg(2), supersededBy: 9}, msg(3, true)];
			removePending(messages, 3);
			expect(messages[1].supersededBy).to.equal(9);
		});

		it("reports a miss", function () {
			const messages = [msg(1), msg(2, true)];
			expect(removePending(messages, 9)).to.equal(false);
			expect(ids(messages)).to.deep.equal([1, 2]);
		});

		it("removes a pending message that is first in the list", function () {
			const messages = [msg(1, true), msg(2)];
			expect(removePending(messages, 1)).to.equal(true);
			expect(ids(messages)).to.deep.equal([2]);
		});

		it("shows an original that is first in the list again", function () {
			const messages = [{...msg(1), supersededBy: 2}, msg(2, true)];
			expect(removePending(messages, 2)).to.equal(true);
			expect(messages[0].supersededBy).to.equal(undefined);
		});
	});
});

describe("Message lookups and reactions (helpers/messageUpdates.ts)", function () {
	describe("findMessageById", function () {
		it("finds the first message as well as the last", function () {
			const messages = [msg(1), msg(2), msg(3)];
			expect(findMessageById(messages, 1)).to.equal(messages[0]);
			expect(findMessageById(messages, 3)).to.equal(messages[2]);
			expect(findMessageById(messages, 9)).to.equal(undefined);
		});
	});

	describe("replyQuote", function () {
		const said = (id: number, msgid: string, nick?: string, text?: string): SharedMsg => ({
			...msg(id),
			msgid,
			...(nick ? {from: {nick}} : {}),
			...(text !== undefined ? {text} : {}),
		});

		it("quotes the message with that msgid, wherever it is", function () {
			const messages = [said(1, "a", "alice", "first"), said(2, "b", "bob", "second")];
			expect(replyQuote(messages, "a")).to.deep.equal({id: 1, nick: "alice", text: "first"});
			expect(replyQuote(messages, "zz")).to.equal(undefined);
		});

		it("does not quote an original an edit has replaced", function () {
			const messages = [{...said(1, "a", "alice", "old"), supersededBy: 2}, said(2, "b")];
			expect(replyQuote(messages, "a")).to.equal(undefined);
		});

		it("quotes a message with no sender or text as empty", function () {
			expect(replyQuote([said(1, "a")], "a")).to.deep.equal({id: 1, nick: "", text: ""});
		});
	});

	describe("applyReaction", function () {
		it("changes nothing when the nick had not reacted with that text", function () {
			const message: SharedMsg = {...msg(1), reactions: [{text: "👍", nicks: ["alice"]}]};
			const before = message.reactions;

			applyReaction(message, "👍", "bob", true);

			expect(message.reactions).to.equal(before);
		});

		it("replaces the list rather than mutating it", function () {
			const message: SharedMsg = {
				...msg(1),
				reactions: [
					{text: "👍", nicks: ["alice", "bob"]},
					{text: "🎉", nicks: ["bob"]},
				],
			};
			const before = message.reactions!;

			applyReaction(message, "🎉", "BOB", true);

			expect(message.reactions).to.not.equal(before);
			expect(message.reactions).to.deep.equal([{text: "👍", nicks: ["alice", "bob"]}]);
			expect(before).to.have.lengthOf(2);
		});
	});
});
