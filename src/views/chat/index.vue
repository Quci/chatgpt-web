<script setup lang='ts'>
// 引入 Vue 的相关模块
import type { Ref } from 'vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
// 引入路由和状态管理相关模块
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
// 引入 Naive-UI 组件和其他外部库
import { NAutoComplete, NButton, NInput, useDialog, useMessage } from 'naive-ui'
import { toPng } from 'html-to-image'
// 引入本地组件和钩子
import { Message } from './components'
import { useScroll } from './hooks/useScroll'
import { useChat } from './hooks/useChat'
import { useUsingContext } from './hooks/useUsingContext'
import HeaderComponent from './components/Header/index.vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useChatStore, usePromptStore } from '@/store'
import { fetchChatAPIProcess } from '@/api'
import { t } from '@/locales'

// 定义全局变量
let controller = new AbortController()
const openLongReply = import.meta.env.VITE_GLOB_OPEN_LONG_REPLY === 'true'

// 初始化路由、弹窗和消息函数
const route = useRoute()
const dialog = useDialog()
const ms = useMessage()

// 初始化 Chat Store
const chatStore = useChatStore()

// 引用基本布局和滚动相关钩子
const { isMobile } = useBasicLayout()
const { addChat, updateChat, updateChatSome, getChatByUuidAndIndex } = useChat()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom } = useScroll()
const { usingContext, toggleUsingContext } = useUsingContext()

const { uuid } = route.params as { uuid: string }

// 用于计算属性
const dataSources = computed(() => chatStore.getChatByUuid(+uuid))
const conversationList = computed(() => dataSources.value.filter(item => (!item.inversion && !!item.conversationOptions)))

// 定义 Ref 类型的变量
const prompt = ref<string>('')
const loading = ref<boolean>(false)
const inputRef = ref<Ref | null>(null)

// 添加 PromptStore
const promptStore = usePromptStore()

// 使用 storeToRefs，保证 store 修改后，联想部分能够重新渲染
const { promptList: promptTemplate } = storeToRefs<any>(promptStore)

// 手动重置页面刷新后的 loading 状态
dataSources.value.forEach((item, index) => {
	if (item.loading)
		updateChatSome(+uuid, index, { loading: false })
})

// 提交表单处理函数
function handleSubmit() {
	onConversation()
}

// 核心聊天逻辑异步函数
async function onConversation() {
	let message = prompt.value
	if (loading.value)
		return
	if (!message || message.trim() === '')
		return

	controller = new AbortController()

	addChat(
		+uuid,
		{
			dateTime: new Date().toLocaleString(),
			text: message,
			inversion: true,
			error: false,
			conversationOptions: null,
			requestOptions: { prompt: message, options: null },
		},
	)
	scrollToBottom()

	loading.value = true
	prompt.value = ''

	let options: Chat.ConversationRequest = {}
	const lastContext = conversationList.value[conversationList.value.length - 1]?.conversationOptions
	if (lastContext && usingContext.value)
		options = { ...lastContext }

	addChat(
		+uuid,
		{
			dateTime: new Date().toLocaleString(),
			text: t('chat.thinking'),
			loading: true,
			inversion: false,
			error: false,
			conversationOptions: null,
			requestOptions: { prompt: message, options: { ...options } },
		},
	)
	scrollToBottom()

	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {
			const messages = [
				{
					role: 'system',
					content: 'You are a helpful assistant'
				}
			]
			conversationList.value.forEach((item, index) => {
				if(item.requestOptions.prompt) {
					messages.push({
						role: 'user',
						content: item.requestOptions.prompt
					})
				}

				if(item.text) {
					messages.push({
						role: 'assistant',
						content: item.text
					})
				}
			})

			messages.push({
				role: 'user',
				content: message
			})

			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				messages,
				options,
				signal: controller.signal,
				onDownloadProgress: ({ event }) => {
					const xhr = event.target
					const { responseText } = xhr
					// Always process the final line
					const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
					let chunk = responseText
					if (lastIndex !== -1)
						chunk = responseText.substring(lastIndex)
					try {
						const data = JSON.parse(chunk)
						updateChat(
							+uuid,
							dataSources.value.length - 1,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText + (data.text ?? ''),
								inversion: false,
								error: false,
								loading: true,
								conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
								requestOptions: { prompt: message, options: { ...options } },
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}

						scrollToBottomIfAtBottom()
					}
					catch (error) {
						//
					}
				},
			})
			updateChatSome(+uuid, dataSources.value.length - 1, { loading: false })
		}

		await fetchChatAPIOnce()
	}
	catch (error: any) {
		const errorMessage = error?.message ?? t('common.wrong')

		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					loading: false,
				},
			)
			scrollToBottomIfAtBottom()
			return
		}

		const currentChat = getChatByUuidAndIndex(+uuid, dataSources.value.length - 1)

		if (currentChat?.text && currentChat.text !== '') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					text: `${currentChat.text}\n[${errorMessage}]`,
					error: false,
					loading: false,
				},
			)
			return
		}

		updateChat(
			+uuid,
			dataSources.value.length - 1,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: { prompt: message, options: { ...options } },
			},
		)
		scrollToBottomIfAtBottom()
	}
	finally {
		loading.value = false
	}
}

// 重新生成消息的处理函数
async function onRegenerate(index: number) {
	if (loading.value)
		return

	controller = new AbortController()

	const { requestOptions } = dataSources.value[index]

	let message = requestOptions?.prompt ?? ''

	let options: Chat.ConversationRequest = {}

	if (requestOptions.options)
		options = { ...requestOptions.options }

	loading.value = true

	updateChat(
		+uuid,
		index,
		{
			dateTime: new Date().toLocaleString(),
			text: '',
			inversion: false,
			error: false,
			loading: true,
			conversationOptions: null,
			requestOptions: { prompt: message, options: { ...options } },
		},
	)

	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {
			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				options,
				signal: controller.signal,
				onDownloadProgress: ({ event }) => {
					const xhr = event.target
					const { responseText } = xhr
					// Always process the final line
					const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
					let chunk = responseText
					if (lastIndex !== -1)
						chunk = responseText.substring(lastIndex)
					try {
						const data = JSON.parse(chunk)
						updateChat(
							+uuid,
							index,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText + (data.text ?? ''),
								inversion: false,
								error: false,
								loading: true,
								conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
								requestOptions: { prompt: message, options: { ...options } },
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}
					}
					catch (error) {
						//
					}
				},
			})
			updateChatSome(+uuid, index, { loading: false })
		}
		await fetchChatAPIOnce()
	}
	catch (error: any) {
		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				index,
				{
					loading: false,
				},
			)
			return
		}

		const errorMessage = error?.message ?? t('common.wrong')

		updateChat(
			+uuid,
			index,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: { prompt: message, options: { ...options } },
			},
		)
	}
	finally {
		loading.value = false
	}
}

// 导出图像的处理函数
function handleExport() {
	if (loading.value)
		return

	const d = dialog.warning({
		title: t('chat.exportImage'),
		content: t('chat.exportImageConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: async () => {
			try {
				d.loading = true
				const ele = document.getElementById('image-wrapper')
				const imgUrl = await toPng(ele as HTMLDivElement)
				const tempLink = document.createElement('a')
				tempLink.style.display = 'none'
				tempLink.href = imgUrl
				tempLink.setAttribute('download', 'chat-shot.png')
				if (typeof tempLink.download === 'undefined')
					tempLink.setAttribute('target', '_blank')
				document.body.appendChild(tempLink)
				tempLink.click()
				document.body.removeChild(tempLink)
				window.URL.revokeObjectURL(imgUrl)
				d.loading = false
				ms.success(t('chat.exportSuccess'))
				Promise.resolve()
			}
			catch (error: any) {
				ms.error(t('chat.exportFailed'))
			}
			finally {
				d.loading = false
			}
		},
	})
}

// 删除消息的处理函数
function handleDelete(index: number) {
	if (loading.value)
		return

	dialog.warning({
		title: t('chat.deleteMessage'),
		content: t('chat.deleteMessageConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: () => {
			chatStore.deleteChatByUuid(+uuid, index)
		},
	})
}

// 清除聊天记录的处理函数
function handleClear() {
	if (loading.value)
		return

	dialog.warning({
		title: t('chat.clearChat'),
		content: t('chat.clearChatConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: () => {
			chatStore.clearChatByUuid(+uuid)
		},
	})
}

// 按下 Enter 键的处理函数
function handleEnter(event: KeyboardEvent) {
	if (!isMobile.value) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			handleSubmit()
		}
	}
	else {
		if (event.key === 'Enter' && event.ctrlKey) {
			event.preventDefault()
			handleSubmit()
		}
	}
}

// 停止当前操作的处理函数
function handleStop() {
	if (loading.value) {
		controller.abort()
		loading.value = false
	}
}

// 搜索选项计算，优化部分
const searchOptions = computed(() => {
	if (prompt.value.startsWith('/')) {
		return promptTemplate.value.filter((item: { key: string }) => item.key.toLowerCase().includes(prompt.value.substring(1).toLowerCase())).map((obj: { value: any }) => {
			return {
				label: obj.value,
				value: obj.value,
			}
		})
	}
	else {
		return []
	}
})

// 反渲染选项
const renderOption = (option: { label: string }) => {
	for (const i of promptTemplate.value) {
		if (i.value === option.label)
			return [i.key]
	}
	return []
}

// 占位符计算
const placeholder = computed(() => {
	if (isMobile.value)
		return t('chat.placeholderMobile')
	return t('chat.placeholder')
})

// 按钮禁用状态计算
const buttonDisabled = computed(() => {
	return loading.value || !prompt.value || prompt.value.trim() === ''
})

// 页脚样式计算
const footerClass = computed(() => {
	let classes = ['p-4']
	if (isMobile.value)
		classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
	return classes
})

// 组件挂载时的生命周期函数
onMounted(() => {
	scrollToBottom()
	if (inputRef.value && !isMobile.value)
		inputRef.value?.focus()
})

// 组件卸载时的生命周期函数
onUnmounted(() => {
	if (loading.value)
		controller.abort()
})
</script>

<template>
	<div class="flex flex-col w-full h-full">
		<HeaderComponent
			v-if="isMobile"
			:using-context="usingContext"
			@export="handleExport"
			@handle-clear="handleClear"
		/>
		<main class="flex-1 overflow-hidden">
			<div id="scrollRef" ref="scrollRef" class="h-full overflow-hidden overflow-y-auto">
				<div
					class="w-full max-w-screen-xl m-auto dark:bg-[#101014]"
					:class="[isMobile ? 'p-2' : 'p-4']"
				>
					<div id="image-wrapper" class="relative">
						<template v-if="!dataSources.length">
							<div class="flex items-center justify-center mt-4 text-center text-neutral-300">
								<SvgIcon icon="ri:bubble-chart-fill" class="mr-2 text-3xl" />
								<span>{{ t('chat.newChatTitle') }}</span>
							</div>
						</template>
						<template v-else>
							<div>
								<Message
									v-for="(item, index) of dataSources"
									:key="index"
									:date-time="item.dateTime"
									:text="item.text"
									:inversion="item.inversion"
									:error="item.error"
									:loading="item.loading"
									@regenerate="onRegenerate(index)"
									@delete="handleDelete(index)"
								/>
								<div class="sticky bottom-0 left-0 flex justify-center">
									<NButton v-if="loading" type="warning" @click="handleStop">
										<template #icon>
											<SvgIcon icon="ri:stop-circle-line" />
										</template>
										{{ t('common.stopResponding') }}
									</NButton>
								</div>
							</div>
						</template>
					</div>
				</div>
			</div>
		</main>
		<footer :class="footerClass">
			<div class="w-full max-w-screen-xl m-auto">
				<div class="flex items-center justify-between space-x-2">
					<HoverButton v-if="!isMobile" @click="handleClear">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:delete-bin-line" />
            </span>
					</HoverButton>
					<HoverButton v-if="!isMobile" @click="handleExport">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:download-2-line" />
            </span>
					</HoverButton>
					<HoverButton @click="toggleUsingContext">
            <span class="text-xl" :class="{ 'text-[#4b9e5f]': usingContext, 'text-[#a8071a]': !usingContext }">
              <SvgIcon icon="ri:chat-history-line" />
            </span>
					</HoverButton>
					<NAutoComplete v-model:value="prompt" :options="searchOptions" :render-label="renderOption">
						<template #default="{ handleInput, handleBlur, handleFocus }">
							<NInput
								ref="inputRef"
								v-model:value="prompt"
								type="textarea"
								:placeholder="placeholder"
								:autosize="{ minRows: 1, maxRows: isMobile ? 4 : 8 }"
								@input="handleInput"
								@focus="handleFocus"
								@blur="handleBlur"
								@keypress="handleEnter"
							/>
						</template>
					</NAutoComplete>
					<NButton type="primary" :disabled="buttonDisabled" @click="handleSubmit">
						<template #icon>
              <span class="dark:text-black">
                <SvgIcon icon="ri:send-plane-fill" />
              </span>
						</template>
					</NButton>
				</div>
			</div>
		</footer>
	</div>
</template>
