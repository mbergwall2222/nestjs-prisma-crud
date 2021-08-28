import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as Joi from 'joi';
import { traverse } from 'object-traversal';
import { CrudQueryFull } from './types';

/**
 * Takes an arbitrarily deep nested `whereObject` and compares if the path to the deepest nested object (excluding its properties)
 * is present in the provided `allowedJoinsSet`.
 */
export function validateNestedWhere(
    whereObject: any,
    allowedJoinsSet: Set<string>,

    // TODO: Document that below keywords should be forbidden in all models
    prismaBlacklistKeywords = [
        // https://www.prisma.io/docs/concepts/components/prisma-client/relation-queries
        'some',
        'none',
        'every',
        'is',
        'isNot',

        // https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#filter-conditions-and-operators
        'equals',
        'not',
        'in',
        'notIn',
        'lt',
        'lte',
        'gt',
        'gte',
        'contains',
        'mode',
        'startsWith',
        'endsWith',
        'AND\\.\\d+',
        'AND',
        'OR\\.\\d+',
        'OR',
        'NOT',
    ],
) {
    const blackListedWordsRegex = `(${prismaBlacklistKeywords.join('|')})`;
    const midOperatorsRegex = new RegExp(`\\.${blackListedWordsRegex}\\.`, 'g');
    const endOperatorsRegex = new RegExp(`\\.${blackListedWordsRegex}$`, 'g');
    const startOperatorsRegex = new RegExp(`^${blackListedWordsRegex}(\\.|$)`, 'g');
    const lastFragmentRegex = /\.?[^.]+$/;
    const leafArrayContentRegex = /\.(in|notIn)\.\d+$/;
    const leafArrayRegex = /\.(in|notIn)$/;

    traverse(whereObject, (context) => {
        const { value, meta } = context;
        const isLeafArrayContent = leafArrayContentRegex.test(meta.currentPath || '');
        const isLeafArray =
            meta.currentPath && value instanceof Array && leafArrayRegex.test(meta.currentPath);
        const isLeafNonArray = !isLeafArrayContent && !(value instanceof Object); // when value is non-objects it means parent are final nodes (except when isLeafArrayContent)
        const isLeaf = isLeafArray || isLeafNonArray;
        if (isLeaf) {
            // leaf paths are the longest
            const leafPath = meta.currentPath!;

            let cleanedupString = leafPath.replace(startOperatorsRegex, '');
            // remove operators from the middle of string
            cleanedupString = cleanedupString.replace(midOperatorsRegex, '.');
            // remove operators from the end of string
            cleanedupString = cleanedupString.replace(endOperatorsRegex, '');
            // remove last fragment, as it is a property (eg. author.firstName)
            cleanedupString = cleanedupString.replace(lastFragmentRegex, '');

            const isAllowed = !cleanedupString || allowedJoinsSet.has(cleanedupString);
            if (!isAllowed) {
                throw new ForbiddenException(`Join relation not allowed: ${cleanedupString}`);
            }
        }
    });
}

export function validateJoins(requestedJoins: string[], allowedJoinsSet: Set<string>) {
    for (let i = 0; i < requestedJoins.length; i++) {
        const reqInclude = requestedJoins[i];
        if (!allowedJoinsSet.has(reqInclude)) {
            throw new ForbiddenException(`Join relation not allowed: ${reqInclude}`);
        }
    }
}

/**
 * Takes an array of arbitrarily deep nested `orderByObjects` and compares if the path to the deepest nested objects (excluding their properties)
 * are present in the provided `allowedJoinsSet`.
 */
export function validateNestedOrderBy(orderByObjects: any[], allowedJoinsSet: Set<string>) {
    const lastFragmentRegex = /\.?[^.]+$/;
    for (let i = 0; i < orderByObjects.length; i++) {
        traverse(orderByObjects[i], (context) => {
            const { value, meta } = context;
            const isLeaf = !(value instanceof Object); // nulls and non-objects are final nodes, except when using 'in' or 'notIn'
            if (isLeaf) {
                // leaf paths are the longest
                const leafPath = meta.currentPath!;
                const pathWithoutLastFragment = leafPath.replace(lastFragmentRegex, '');

                const isAllowed =
                    !pathWithoutLastFragment || allowedJoinsSet.has(pathWithoutLastFragment);
                if (!isAllowed) {
                    throw new ForbiddenException(
                        `Join relation not allowed: ${pathWithoutLastFragment}`,
                    );
                }
            }
        });
    }
}

const crudQueryFullSchema = Joi.object({
    where: Joi.object().required(),
    joins: Joi.array()
        .items(Joi.string())
        .required(),
    select: Joi.object({
        only: Joi.array().items(Joi.string()),
        except: Joi.array().items(Joi.string()),
    }).required(),
    orderBy: Joi.array().items(Joi.object()),
    page: Joi.number()
        .integer()
        .min(1),
    pageSize: Joi.number()
        .integer()
        .min(1),
});
export function validateCrudQueryFull(fullCrudQuery: CrudQueryFull) {
    const { error } = crudQueryFullSchema.validate(fullCrudQuery);
    if (error) {
        throw new BadRequestException(`fullCrudQuery did not match schema: \n${error}`);
    }
}
