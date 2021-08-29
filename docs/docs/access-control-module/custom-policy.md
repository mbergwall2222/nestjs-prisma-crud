---
sidebar_position: 5
---

# Custom Policies

<a name="policymethod"></a>

The [`AccessPolicy`](./access-policy) decorator supports more complex policies custom made for your specific use cases.

A policy is any function with the following signature:

```ts
type PolicyMethod = (ctx: ExecutionContext, authData: any, moduleRef: ModuleRef) => void;
```

A short summary of what the parameters mean:

-   **`ctx: ExecutionContext`**: useful when the `request` object is needed for your business logic. See [NestJS execution context](https://docs.nestjs.com/fundamentals/execution-context#execution-context) for more.
-   **`authData: any`**: the user's metadata generated by your authentication middleware. Commonly used for accessing user/session information. Retrieved using [authDataKey](./access-control-module#optsauthdatakey).
-   **`moduleRef: ModuleRef`**: commonly used when accessing injected dependencies such as `PrismaService` inside your policy functions. See [NestJS module reference](https://docs.nestjs.com/fundamentals/module-ref#module-reference).

## Recipes

:::tip
Examples below only seek to illustrate the custom policies capabilities.

The features they implement would likely not be implemented like that in practice!!
:::

### JohnnyIsBanned Policy

This is an example of a simple static policy that throws `403` errors for the user named **Johnny**.

#### Implementation

```ts title=johnny-is-banned.policy.ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

export const JohnnyIsBanned = (ctx: ExecutionContext, authData: any, moduleRef: ModuleRef) => {
    if (authData.user.name === 'Johnny') {
        throw new ForbiddenException('Bye Johnny!');
    }
};
```

#### Usage

```ts title=party.controller.ts {5}
@Controller('party')
export class PartyController {
    // ...
    @Get()
    @AccessPolicy('everyone', JohnnyIsBanned)
    async getParties(@Query('crudQuery') crudQuery: string) {
        const match = await this.partyService.findMany(crudQuery);
        return match;
    }
}
```

### BannedPeople Policy

This takes the same idea of the previous example, but now we have a function that receives a **list of names to ban**, and returns a [PolicyMethod](#policymethod).

#### Implementation

```ts title=banned-people.policy.ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

export const BannedPeople = (bannedNames: string[]) => (
    ctx: ExecutionContext,
    authData: any,
    moduleRef: ModuleRef,
) => {
    if (bannedNames.includes(authData.user.name)) {
        throw new ForbiddenException('You are not alone Johnny!');
    }
};
```

#### Usage

```ts title=party.controller.ts {5}
@Controller('party')
export class PartyController {
    // ...
    @Get()
    @AccessPolicy('everyone', BannedPeople(['Johnny', 'Danny']))
    async getParties(@Query('crudQuery') crudQuery: string) {
        const match = await this.partyService.findMany(crudQuery);
        return match;
    }
}
```

### DbBannedPeople Policy

This example takes the same idea of the previous, but **queries the database** instead of using a hard coded list.

#### Implementation

```ts title=db-banned-people.policy.ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

export const DbBannedPeople = (ctx: ExecutionContext, authData: any, moduleRef: ModuleRef) => {
    const prismaService = moduleRef.get(PrismaService, { strict: false });
    const bannedPeople = prismaService.bannedPeople.findMany();

    if (bannedPeople.includes(authData.user.name)) {
        throw new ForbiddenException('You have been banned!');
    }
};
```

#### Usage

```ts title=party.controller.ts {5}
@Controller('party')
export class PartyController {
    // ...
    @Get()
    @AccessPolicy('everyone', DbBannedPeople)
    async getParties(@Query('crudQuery') crudQuery: string) {
        const match = await this.partyService.findMany(crudQuery);
        return match;
    }
}
```

### HideDrafts Policy (extending [crudQuery](../client-side))

In this section we are going to write a policy that modifies the final prisma query, by extending the client's provided [`crudQuery`](../client-side) and adding additional constraints to it.

This is extremely useful when a user must be granted access to only a subset of records from a given table. This method ensures that we scope the client's access while not breaking the requested sorting/filtering/pagination.

Below is a policy that only retrieves non-draft `parties` from the database. The highlighted `additionalConstraints` can be any [prisma filter object](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#filter-conditions-and-operators) .

#### Implementation

```ts title=hide-drafts.policy.ts {15,16,20}
import { ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CrudQuery } from 'nestjs-prisma-crud';

export const HideDrafts = (ctx: ExecutionContext, _authData: any, _moduleRef: ModuleRef) => {
    // get crudQuery from the request's query params
    const request = ctx.switchToHttp().getRequest();
    const query = request.query;
    const crudQuery: string = query.crudQuery;

    // get client provided `.where`, if any
    const parsedCrudQuery: CrudQuery = crudQuery ? JSON.parse(crudQuery) : {};
    const clientWhere = parsedCrudQuery.where || {};

    // additionalConstraints is any valid prisma filter object
    const additionalConstraints = { state: { not: 'DRAFT' } };

    // override client `.where`, adding the additional `AND` clause
    parsedCrudQuery.where = {
        AND: [additionalConstraints, clientWhere],
    };

    request.query.crudQuery = JSON.stringify(parsedCrudQuery);
};
```

#### Usage

```ts title=party.controller.ts {5}
@Controller('party')
export class PartyController {
    // ...
    @Get()
    @AccessPolicy('everyone', HideDrafts)
    async getParties(@Query('crudQuery') crudQuery: string) {
        const match = await this.partyService.findMany(crudQuery);
        return match;
    }
}
```