import { chatWithPet, getSessionScope } from "./api";
import { createConversationStore } from "./petConversation";

export const petSession = createConversationStore(wx, getSessionScope, chatWithPet);
