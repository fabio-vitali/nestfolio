export const chain = new Choice(scope, 'RowPresent').when(Condition.isPresent('$.row'), next).otherwise(tolerate);
