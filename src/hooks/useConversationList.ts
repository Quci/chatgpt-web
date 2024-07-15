import {useRoute} from "vue-router";
import {computed} from "vue";
import {useChatStore} from "@/store";


const useConversationList = () => {
	const route = useRoute()
	const { uuid } = route.params as { uuid: string }
	const chatStore = useChatStore()
	const dataSources = computed(() => chatStore.getChatByUuid(+uuid))
	return dataSources
}

export default useConversationList
