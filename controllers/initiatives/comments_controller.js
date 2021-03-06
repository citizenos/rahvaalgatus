var Path = require("path")
var Router = require("express").Router
var Initiative = require("root/lib/initiative")
var InitiativesController = require("../initiatives_controller")
var HttpError = require("standard-http-error")
var isOk = require("root/lib/http").isOk
var catch400 = require("root/lib/fetch").catch.bind(null, 400)
var translateCitizenError = require("root/lib/api").translateError
var next = require("co-next")
var format = require("util").format
var commentsPath = format.bind(null, "/api/users/self/topics/%s/comments")
var EMPTY_COMMENT = {subject: "", text: "", parentId: null}

exports.router = Router({mergeParams: true})

exports.router.post("/", next(function*(req, res, next) {
	var initiative = req.initiative
	var subpage = req.body.referrer || initiativePath(initiative)

	var created = yield req.api(commentsPath(initiative.id), {
		method: "POST",
		json: {
			parentId: null,
			type: "pro",
			subject: req.body.subject,
			text: normalizeNewlines(req.body.text)
		}
	}).catch(catch400)

	if (isOk(created)) {
		var comment = created.body.data
		var path = Path.dirname(req.baseUrl)
		path += "/" + subpage + "#comment-" + comment.id
		res.redirect(303, path)
	}
	else {
		res.locals.comment = req.body
		renderWithError(subpage, created.body, req, res, next)
	}
}))

exports.router.get("/:commentId", next(function*(req, res) {
	var initiative = req.initiative

	// NOTE: CitizenOS doesn't have a comment endpoint.
	var path = `/api/topics/${initiative.id}/comments`
	if (req.user) path = "/api/users/self" + path.slice(4)
	var comments = yield req.api(path)
	comments = comments.body.data.rows.map(normalizeComment)

	var comment = comments.find((comment) => comment.id === req.params.commentId)
	if (comment == null) throw new HttpError(404)

	res.render("initiatives/comments/read", {
		comment: comment,
		editedComment: EMPTY_COMMENT
	})
}))

exports.router.post("/:commentId/replies", next(function*(req, res, next) {
	var initiative = req.initiative
	var commentId = req.params.commentId
	var subpage = req.body.referrer || initiativePath(initiative)

	var created = yield req.api(commentsPath(initiative.id), {
		method: "POST",
		json: {
			parentId: commentId,
			type: "reply",
			text: normalizeNewlines(req.body.text)
		}
	}).catch(catch400)

	if (isOk(created)) {
		var comment = created.body.data
		var path = Path.dirname(req.baseUrl)
		path += "/" + subpage + "#comment-" + comment.id
		res.redirect(303, path)
	}
	else {
		res.locals.comment = {__proto__: req.body, parentId: commentId}
		renderWithError(subpage, created.body, req, res, next)
	}
}))

function renderWithError(subpage, err, req, res, next) {
	var msg = translateCitizenError(req.t, err)
	res.flash("error", msg)
	res.flash("commentError", msg)
	res.status(422)
	InitiativesController.read(subpage, req, res, next)
}

function normalizeComment(comment) {
	comment.replies = comment.replies.rows
	return comment
}

function initiativePath(initiative) {
	switch (Initiative.getUnclosedStatus(initiative)) {
		case "inProgress": return "discussion"
		case "voting": return "vote"
		case "followUp": return "events"
		default: throw new RangeError("Invalid status: " + initiative.status)
	}
}

function normalizeNewlines(text) { return text.replace(/\r\n/g, "\n") }
