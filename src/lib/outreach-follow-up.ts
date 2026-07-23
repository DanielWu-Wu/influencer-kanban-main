type DatedMessage = {
  date: string;
};

function messageTime(message: DatedMessage) {
  return new Date(message.date || 0).getTime();
}

export function classifyFollowUpConversation<T extends DatedMessage>(
  outbound: T[],
  humanReplies: T[],
) {
  const initialOutreach = outbound[0] || null;
  if (!initialOutreach) {
    return {
      outboundBeforeReply: [] as T[],
      humanRepliesAfterOutreach: [] as T[],
    };
  }

  const initialOutreachTime = messageTime(initialOutreach);
  const humanRepliesAfterOutreach = humanReplies
    .filter((message) => messageTime(message) >= initialOutreachTime)
    .sort((a, b) => messageTime(a) - messageTime(b));
  const firstHumanReply = humanRepliesAfterOutreach[0] || null;

  if (!firstHumanReply) {
    return {
      outboundBeforeReply: outbound,
      humanRepliesAfterOutreach,
    };
  }

  const firstHumanReplyTime = messageTime(firstHumanReply);
  return {
    outboundBeforeReply: outbound.filter((message, index) => (
      index === 0 || messageTime(message) < firstHumanReplyTime
    )),
    humanRepliesAfterOutreach,
  };
}
