import { useGetMe as useGetMeQuery } from "@workspace/api-client-react";
import type { CurrentUser } from "@workspace/api-client-react";

export function useGetMe(): CurrentUser | undefined {
  const { data } = useGetMeQuery();
  return data;
}
